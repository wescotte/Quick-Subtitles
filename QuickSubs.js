/* 
Copyright 2014 Eric Wescott - wescotte@gmail.com

This file is part of Quick Subtitles.

Foobar is free software: you can redistribute it and/or modify it under the terms of the
GNU General Public License as published by the Free Software Foundation, either version 3
of the License, or (at your option) any later version.

Foobar is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with Foobar. If
not, see http://www.gnu.org/licenses/.
*/

/* TODO: 
	TAB doesn't let you set an in point when no video is loading but typing any key in the box does.. Look into this.
	
	Look into rounding errors converting SRT to Native and Native to SRT
	
	Error Message Cleanup:
		Add better more descriptive error messages and have it highlight the problem rows
		
	CSS Cleanup:
		"Enter Subtitles Here" section to format w/o using a table
		
	Event Handler Cleanup:
		Get rid of all the onchange, onclick, etc in the HTML and use addEventListener()'s instead
	
	Look into onChange events to verify that when changes are made no subtitles collide or have invalid in/out points
		Handle overlap with "snap to" sorta functionality?
		
	Highlight subtitle in Waveform preview and rightSide for actively displayed AND/OR
		subtitle that will be affected by UP/DOWn arrow
		
	Hotkey to speed up/slow down playback
	
	UNDO ability for time adjustments??
	an UNDO_LEVEL value where every time you slide you record the rows/oldtimecodes and add UNDO_LEVEL+1
	Every time you undo you UNDO_LEVEL-1 and restore the old rows timecodes
		probably need to keep subtitles sorted for this
	
	Fix time adjustment functionality to better check for problems and display them to the user
	
	Add PAL support and for STL exports
	
	Load text file as new subs by newlines 
		squish to end of video and separate by 1 frame so UP/DOWN arrow can quickly resync
			Add "squish" button for selected subs so you can resync easily
*/

/* Start CURRENT_ROW = 1 for two reasons...
	1: ROW0, IN0, OUT0, and SUB0 are in a different table and are used for values the user is currently enterting
	2: It also allows us to skip the <th> row in the table when we access things randomly
*/
var CURRENT_ROW = 1;

// This value keeps track of the last checkbox we selected which enables the SHIFT+click to select a range of checkboxes functionality to work
var LAST_BOX=-1;

/* This is the out point (in HTML5 native timecode) of the currently displaying realtime subtitle. If the video's current time exceeds this value
	then we know we should check to see if a new subtitle should be displayed. This way we're not wasting CPU cycles by scanning our entire subtitle
	list looking for what subtitle should be displayed at every frame.
*/
var CANVAS_HEIGHT;
var CANVAS_WIDTH;
	
var DISPLAYING_SUB_OUT_POINT=0;
var PREVIEW_SAMPLES;
var SECONDS_TO_PREVIEW = 7;
var LINES_PER_SECOND;	
var VIDEO_SAMPLE_RATE;
var PAST_WAVEFORM_AMOUNT=1.5; // Show past 1.5 seconds of waveform

function showInstructions() {
	var iDiv=document.getElementById("instructionsContainer");
	iDiv.style.display="block";
}
function hideInstructions() {
	var iDiv=document.getElementById("instructionsContainer");
	iDiv.style.display="none";
}

function pad(number, length) {
    var str = '' + number;
    while (str.length < length) {
        str = '0' + str;
    }
    return str;
}

function loadSRTFile() {
	var table=document.getElementById("subtitles");
	if (table.rows.length > 0) {
		message="WARNING: You currently have subtitle data in your project!\n\nIf you click OK we will attempt to merge the two projects.\n\n" 
			+ "If this is not what you want either reload the page to start from a blank project or click CANCEL and delete all subtitles first.";
		if (!confirm(message)) {
			document.getElementById("loadSubtitles").value=""; // Reset the file as we didn't actually open anything in case user selects it again.
			return; 
		} 
	}
	
	var file = this.files[0];	
	var reader = new FileReader();	
		
	reader.onload = function(e) {		
		var srtStep = 0;
		var counttext = 0;
		var lines = reader.result.split("\n");
		var counter=0;
		var line="";
		
		// Backup current values because we are will be overwriting them to reuse the addSub() code
		var oldIn=getTimecode("IN", 0);
		var oldOut=getTimecode("OUT", 0);
		var oldSub=getSubtitle(0);
			
		for (var l in lines) {
			line=lines[l];
			counter++;
			if (line.trim() == "") {
				srtStep = 0;
				if (counttext > 0)
				{
					addSub(-1);
					// addSub() normally clears the subtitle(0) but it won't on failure/time conflict so we should manually have to do it here as well
					setSubtitle(0, "");
					counttext = 0;
				}
			} else if (srtStep == 0) {
				// TODO: Figure out why the commented line below doesn't break the loading...
				// document.getElementById("SUB0").value="";
				srtStep = 1;
				counttext = 0;
			} else if (srtStep == 1) {
				var times = line.split(' ');
				if (times[1] == "-->")
				{
					setTimecode("IN",  0, times[0].trim() );
					setTimecode("OUT", 0, times[2].trim() );
					srtStep = 2;
				}
			} else if (srtStep == 2) {	
				if (counttext > 0) 
					setSubtitle(0, getSubtitle(0) + "\n");
					
				counttext++;
				setSubtitle(0, getSubtitle(0) + line.trim());
				
				// We are on the last line so make sure we add the final subtitle
				if (counter == lines.length)
				{
					addSub(-1);
					// addSub() normally clears the subtitle(0) but it won't on failure/time conflict so we should manually have to do it here as well			
					setSubtitle(0, "");
				}
			}									
		}
		
		// Restore current values now that the file is loaded.
		setTimecode("IN", 0, oldIn);
		setTimecode("OUT", 0, oldOut);
		setSubtitle(0, oldSub);		
		
		// Reset the file value to "" in the event the user attempts to load the same file again.
		document.getElementById("loadSubtitles").value="";
	}

	reader.readAsText(file);
}
function saveSRTFile(event) {
	if (CURRENT_ROW == 1) {
		alert("Nothing to save because your subtitle project is empty...");
		return;
	}

	var text="";
	var IN, OUT, SUB;
	var filename = "subtitles.srt";
	if (document.getElementById("loadVideo") != null && document.getElementById("loadVideo").value != "") {
		filename = document.getElementById("loadVideo").value;
		filename = filename.substr(0, filename.lastIndexOf('.') ) + ".srt";		// Strip file extension
		filename = filename.substr(	filename.lastIndexOf('\\') + 1, filename.length );	// Strip full path from front
	}
	filename = prompt("What would you like call your subtitles file?", filename);

	if (filename == null) // User clicked cancel  
		return;
	else if (filename == "") {
		alert("Invalid filename");
		return;
	}
	
	for (var i=1; i < CURRENT_ROW; i++) {
		IN=getTimecode("IN",i);
		OUT=getTimecode("OUT",i);
		SUB=getSubtitle(i)
		text += i + "\n"
		text += IN + " --> " + OUT + "\n";
		text += SUB + "\n\n";
	} 

	var content=[text];
	var myFile = new Blob(content, {type: 'text/plain'});

	var a = document.createElement('a');
	a.href = window.URL.createObjectURL(myFile);
	a.download = filename;
	document.body.appendChild(a);
	a.click(); 
}

function exportSTL(event) {
	if (CURRENT_ROW == 1) {
		alert("Nothing to save because your subtitle project is empty...");
		return;
	}
	
	message = "WARNING: At this time Quick Subtitles can only read SRT file format. If you intend to do future revisions this project you will also want to" + 
		"save your project as an SRT file to ensure future compatibility. ";
	alert(message);

	var text="";
	var IN, OUT, SUB;
	var filename = "subtitles.stl";
	if (document.getElementById("loadVideo") != null && document.getElementById("loadVideo").value != "") {
		filename = document.getElementById("loadVideo").value;
		filename = filename.substr(0, filename.lastIndexOf('.') ) + ".stl";		// Strip file extension
		filename = filename.substr(	filename.lastIndexOf('\\') + 1, filename.length );	// Strip full path from front
	}
	filename = prompt("What would you like call your subtitles file?", filename);

	if (filename == null) // User clicked cancel  
		return;
	else if (filename == "") {
		alert("Invalid filename");
		return;
	}
	

	// TODO: Allow use to modify these settings but for now I just ripped these from a sample file	
	text="//English subtitles\n"
		+ "$FontName           = Helvetica Neue\n"
		+ "$FontSize           = 28\n"
		+ "$Bold               = 1\n"
		+ "$HorzAlign          = Center\n"
		+ "$VertAlign          = Bottom\n"
		+ "$XOffset            = 0\n"
		+ "$YOffset            = 20\n"
		+ "$ColorIndex1        = 7\n"
		+ "$ColorIndex2        = 1\n"
		+ "$ColorIndex3        = 1\n"
		+ "$ColorIndex4        = 1\n"
		+ "$Contrast1          = 15\n"
		+ "$Contrast2          = 15\n"
		+ "$Contrast3          = 10\n"
		+ "$Contrast4          = 0\n"
		+ "$ForceDisplay       = FALSE\n"
		+ "$FadeIn             = 0\n"
		+ "$FadeOut            = 0\n"
		+ "$TapeOffset         = FALSE\n\n";

	for (var i=1; i < CURRENT_ROW; i++) {
		IN=getTimecode("IN",i);
		IN=IN.substr(0,8) + ":" + calcSTLFrame(IN.substr(9,3));
		
		OUT=getTimecode("OUT",i);
		OUT=OUT.substr(0,8) + ":" + calcSTLFrame(OUT.substr(9,3));
				
		SUB=getSubtitle(i)
		
		SUB=SUB.replace(/<br>|<BR>|<br\/>|<BR\/>|<\/br>|<\/BR>|\n/g, " | ");
		SUB=SUB.replace(/<i>|<\/i>|<I>|<\/I>/g, '^I');
		SUB=SUB.replace(/<b>|<\/b>|<B>|<\/B>/g, '^B');	
						
		text += IN + " , " + OUT + " , " + SUB + "\n";
	} 
	
	var content=[text];
	var myFile = new Blob(content, {type: 'text/plain'});

	var a = document.createElement('a');
	a.href = window.URL.createObjectURL(myFile);
	a.download = filename;
	document.body.appendChild(a);
	a.click(); 
	
}
function calcSTLFrame(time) {
	// TODO: Allow user to specify other frame rates but for now default to NTSC
	const oneFrame = 1000/(30000/1001);
	
	return pad(Math.floor(time / oneFrame), 2);
}

function init() {      
	playSelectedFile = function playSelectedFileInit(event) {
		var file = this.files[0];
		var type = file.type;		
		var videoNode = document.querySelector('video');
		var canPlay = videoNode.canPlayType(type);
		canPlay = (canPlay === '' ? ' Your browser does not support this video format.' : canPlay);
		var message = type + ':' + canPlay;
		var isError = canPlay === 'This format is not supported';
		updateStatusMessage(message);
		if (isError) {
			return;
		}
			
		var fileURL = URL.createObjectURL(file);
		videoNode.src = fileURL;
		
		var videoTag = document.getElementById("video");
		var timeTag = document.getElementById('currentTimecode');
		videoTag.addEventListener('timeupdate',processTimeUpdate);
		videoTag.addEventListener('play', resetDisplayedSubtitle);
		videoTag.addEventListener('seeked', resetDisplayedSubtitle);

		// We have to ensure the video is actually loaded before we should generate a waveform
		setTimeout(checkReady, 500);			
	}
	
	// Setup the font settings values
	var overlay=document.getElementById("overlaySubtitle");
	var style=window.getComputedStyle(overlay);
	document.getElementById("fontColor").value=makeColorFromString(style.getPropertyValue('color'));
	document.getElementById("bgColor").value=makeColorFromString(style.getPropertyValue('background-color'));
	var fontSize=style.getPropertyValue("font-size");
	fontSize=fontSize.replace("px", "");
	document.getElementById("fontSize").value=fontSize;
	document.getElementById("fontOpacity").value=parseFloat(style.getPropertyValue("opacity")).toFixed(2);
		
	var loadVideo = document.getElementById('loadVideo');
	var loadSubtitles = document.getElementById("loadSubtitles");
	var saveSubtitles = document.getElementById("saveSubtitles");
		
	var URL = window.URL || window.webkitURL
	if (!URL) {
		updateStatusMessage('Your browser is not ' + 
						'<a href="http://caniuse.com/bloburls">supported</a>!');
	} else {    
		loadVideo.addEventListener('change', playSelectedFile, false);
		loadSubtitles.addEventListener('change', loadSRTFile, false);	
		document.addEventListener('keydown', processKeyboardInput);
		document.addEventListener('keyup', processKeyboardInputKeyUp);
		
		document.getElementById("IN0").addEventListener('change', updateNativeTimecode);
		document.getElementById("OUT0").addEventListener('change', updateNativeTimecode);
		document.getElementById("SUB0").addEventListener('input', updateSubtitle);	
		
		var shift0=document.getElementById("SHIFT0");
		shift0.addEventListener('input', shiftSub);	
		shift0.addEventListener('change', shiftSubFinalize);
		
		document.getElementById("waveformPreview").addEventListener("mousemove", dragWaveform);						
	}
}

function checkReady() {
	var videoTag = document.getElementById("video");
	if (videoTag.readyState === 4)
		generateWaveformPreview();
	else		
		setTimeout(checkReady, 1000);
}

function generateWaveformPreview() {
	var waveformPreview=document.getElementById("waveformPreview");
	var style=window.getComputedStyle(waveformPreview);
	CANVAS_WIDTH=parseInt(style.getPropertyValue('width'));
	CANVAS_HEIGHT=parseInt(style.getPropertyValue('height'));
	waveformPreview.width=CANVAS_WIDTH;
	waveformPreview.height=CANVAS_HEIGHT;
	
	LINES_PER_SECOND=Math.round(CANVAS_WIDTH / SECONDS_TO_PREVIEW);
	console.log("Lines per second:" + LINES_PER_SECOND);
	
	var videoTag=document.getElementById("video");
	var file = document.getElementById('loadVideo').files[0];
	
	var fileReader = new FileReader();
	fileReader.onload = function(e) {
	  	var arrayBuffer = e.target.result;
	  	var audioContext;
		if('audioContext' in window) {
			audioContext = new AudioContext();
			console.log("not using webkit");
		}
		else if('webkitAudioContext' in window) {
			audioContext = new webkitAudioContext();
			console.log("using webkit");
		}	  	
	  	
	  	console.log("loaded");
        audioContext.decodeAudioData( arrayBuffer, compressSamples );  
	}
	fileReader.onerror = function(e) {
		console.log("Error reading file");
		console.log(e);
	}
		
	fileReader.readAsArrayBuffer(file);	
}
function compressSamples(buffer) {
	console.log(buffer);
	
	VIDEO_SAMPLE_RATE=buffer.sampleRate;
	var totalSamples=Math.ceil(buffer.duration * VIDEO_SAMPLE_RATE / LINES_PER_SECOND);	
	PREVIEW_SAMPLES=new Uint8Array(totalSamples);	
	console.log("total samples: " + totalSamples);
	        
	var data = buffer.getChannelData(0);
	var min = 1.0;
	var max = -1.0;
	var step=0;
	var currentSample=0;       	
	
	for (i=0; i < data.length; i++) {
		step++;
	
		if (step >= (VIDEO_SAMPLE_RATE / LINES_PER_SECOND) ) {
//		if (step == LINES_PER_SECOND)  {		
			PREVIEW_SAMPLES[currentSample]=Math.abs(min-max) * CANVAS_HEIGHT;
			currentSample++;
			step=0;
			min=1.0;
			max=-1.0;            			
		}
		if (data[i] < min)
			min = data[i]
		if (data[i] > max)
			max = data[i];
	}
	setInterval(drawWaveform, 1000/20);
	forceDraw();
	console.log(PREVIEW_SAMPLES);
	console.log("done: currentSample:" + currentSample + " CompressedSampleBuffer:" + PREVIEW_SAMPLES.length + " FullSamples:" + data.length);
}
function drawWaveform() {
	var videoTag=document.getElementById("video");
	
	// Don't draw anything if we don't have to.	
	if ( (videoTag.paused || videoTag.ended ) && videoTag.getAttribute("forceRedraw") == "false") {
		return;
	}
	videoTag.setAttribute("forceRedraw", "false");
	
	var startSample=Math.floor((videoTag.currentTime - PAST_WAVEFORM_AMOUNT) * LINES_PER_SECOND);

	var canvas = document.getElementById("waveformPreview");
	var ctx=canvas.getContext('2d');
	
	ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
	
	// Draw the playhead
	ctx.fillStyle = '#FFFFFF';		
	ctx.fillRect(LINES_PER_SECOND * PAST_WAVEFORM_AMOUNT,0,2,CANVAS_HEIGHT);
	
	// Draw the audio samples
	ctx.fillStyle = '#F6D565';	
	for (var i=0; i < CANVAS_WIDTH; i++) {
		if (i+startSample > PREVIEW_SAMPLES.length)
			break;
		if (i+startSample > 0) {
			var offset=(parseInt(CANVAS_HEIGHT) - parseInt(PREVIEW_SAMPLES[startSample+i])) / 2;
			ctx.fillRect(i, offset, 1, PREVIEW_SAMPLES[startSample+i]);
		}	
	}
	
	// Draw any subtitles that appear within the audio currently being displayed
	var x,y,w,h;
	h=-15; y=CANVAS_HEIGHT;
   	ctx.strokeStyle = "#000000";
    ctx.lineWidth   = 2;
    	
	var startTime=videoTag.currentTime - PAST_WAVEFORM_AMOUNT;
	var endTime=startTime + SECONDS_TO_PREVIEW;
	for (var i=0; i < CURRENT_ROW; i++) {
		var curIn=getTimecodeNative("IN", i);
		var curOut=getTimecodeNative("OUT", i);
		
		var draw=false;
		if (i == 0) {
			if (curOut == Number.POSITIVE_INFINITY)
				curOut=videoTag.currentTime;
			ctx.fillStyle = "rgba(0,255,0,.5)";
			draw=true;	
		} else if (curIn <= videoTag.currentTime && curOut >= videoTag.currentTime) {
			ctx.fillStyle = "rgba(0,255,0,.5)";
			draw=true;
		} else if (curIn >= startTime && curIn <= endTime) {
			ctx.fillStyle = "rgba(25,25,25,.5)";			
			draw=true;
		} else if (curOut >= startTime && curOut <= endTime) {
			ctx.fillStyle = "rgba(25,25,25,.5)";					
			draw=true;
		}
		
		if (draw) {			
			x=(curIn - startTime)*LINES_PER_SECOND;
			w=(curOut - curIn)*LINES_PER_SECOND;
/*			TODO: Fix drawing outside of the bounds of the canvas for slight performance boost.
			if (x < 0)
				x=0;
			if (w > canvas.width)
				w = (videoTag.currentTime - Math.max(curIn, startTime) ) * LINES_PER_SECOND;
*/	
			ctx.fillRect(x,y,w,h);	
			ctx.strokeRect(x,y,w,h);	
			
			ctx.fillStyle = "rgb(255,255,255)";
			ctx.fillText(getSubtitle(i),x+5,y-4,w);
		}
	}
}

function makeColorFromString(str) {
	// TODO: Test to ensure it's rgb(...) format before converting
	var a = str.split("(")[1].split(")")[0];

	a = a.split(",");

	var b = a.map(function(x){             //For each array element
		x = parseInt(x).toString(16);      //Convert to a base16 string
		return (x.length==1) ? "0"+x : x;  //Add zero if we get only one character
	})

	b = "#"+b.join("");
	return b;
}
function updateFontSize(s) {
	if (isNaN(s) || s < 0) {
		updateStatusMessage("Invalid font size.. Value must be greater than 0");
	} else {
		document.getElementById("overlaySubtitle").style.fontSize = s + "px";
	}
}
function updateFontOpacity(o) {
	if (isNaN(o) || (o < 0.0 || o > 1.0)) {
		updateStatusMessage("Invalid opacity... Must be greater than 0.0 >= opacity <= 1.0");
	} else {
		document.getElementById("overlaySubtitle").style.opacity = o;
	}
}

function updateOverlayText(newValue) {
	// Change newlines into <br/> so it displays properly in a <p> tag.
	document.getElementById("overlaySubtitle").innerHTML=newValue.replace(/\n/g, "<br/>").trim();
}

function setTimecode(type, row, newValue) {
	var node = document.getElementById(type + row);
	var changeEvent = new Event('change');
	
	node.value = newValue;
	node.dispatchEvent(changeEvent);
}
function setTimecodeNative(type, row, newValue) {
	var node = document.getElementById(type + row);
	var changeEvent = new Event('change');
	
	// The conversion from native to SRT gets screwy with fractional parts under 1/1000 of a second so it's best to round those off.
	newValue=Math.round(newValue * 1000) / 1000;
	node.setAttribute("data-nativetc", newValue);
	node.value=convertTC_NativetoSRT(newValue);
}

function getTimecode(type, row) {
	return document.getElementById(type + row).value.trim();
}
function getTimecodeNative(type, row) {
	var tc=document.getElementById(type + row);
	if (tc.hasAttribute("data-nativetc"))
		return Number( tc.getAttribute("data-nativetc") );
	else
		return Number.POSITIVE_INFINITY;
}

function setSubtitle(row, newValue) {
	document.getElementById("SUB" + row).value=newValue;	
}
function getSubtitle(row) {
	return document.getElementById("SUB" + row).value;
}
function updateSubtitle(event) {	
	var currentIn=document.getElementById("IN0");
	if (getTimecode("IN", 0) == "") {
		setTimecode("IN", 0, document.getElementById("currentTimecode").innerHTML);
		return;
	} else 
		resetDisplayedSubtitle();
}

function getIndexFromTimecode(type, time) {
	var index=-1;
	for (var i=0; i < CURRENT_ROW; i++) {
		if (getTimecode(type, i) == time) {
			index=i;
			break;
		}
	}
	return index;
}
function getIndexFromTimecodeNative(type, time) {
	var index=-1;
	for (var i=0; i < CURRENT_ROW; i++) {
		if (getTimecodeNative(type, i) == time) {
			index=i;
			break;
		}
	}
	return index;
}

function updateNativeTimecode(event) {
	this.setAttribute("data-nativetc", convertTC_SRTtoNative(this.value));
	resetDisplayedSubtitle(event);
}

function processTimeUpdate(event) {
	var videoTag = document.getElementById("video");
	var timeTag = document.getElementById('currentTimecode');
	
	timeTag.innerHTML = convertTC_NativetoSRT(videoTag.currentTime);
	document.getElementById('currentTimecodeNative').innerHTML=videoTag.currentTime;
	
	var IN, OUT;
	var time=Number(videoTag.currentTime);
	
	// Don't bother attempting to update the subtitle text if we haven't reached the outpoint of the current subtitle.
	if (time < DISPLAYING_SUB_OUT_POINT)
		return;

	// First check added subtitles to see if our currentTime is between any of their IN/OUT points
	//	If not then we check the subtitle currently being entered and display that one.
	var index=getIndexForSurroundingTime(time);
	if (index != -1) {
		updateOverlayText(getSubtitle(index));
		DISPLAYING_SUB_OUT_POINT=getTimecodeNative("OUT", index);
		if (index > 0) { // We don't want to scroll the the main data entry row because it doesn't exist in this table
			var target = document.getElementById("ROW"+index);
			document.getElementById("scrollingSection").scrollTop = target.offsetTop;
		}		
	} else {
		IN=getTimecodeNative("IN", 0);
		OUT=getTimecodeNative("OUT", 0);
		// TODO: Think about if OUT should just be the NEXT inPoint or if infinity is okay...
		if (getTimecode("OUT",0) == "")
			OUT=Number.POSITIVE_INFINITY;
			
		if (time >= IN && time <= OUT) {
			updateOverlayText(getSubtitle(0));
			DISPLAYING_SUB_OUT_POINT=OUT;		
		} else
			updateOverlayText("");			
	}
}	
	
function resetDisplayedSubtitle() {
	/* This needs to be reset anytime the user pauses or seeks to a different point in the video because the value will always be 
		greater than currentTime if they scrub backwards and thus it won't attempt to display previous subtitles.
	*/
	DISPLAYING_SUB_OUT_POINT=0;
}
		
function convertTC_NativetoSRT(oldTC) {
		timecode = parseInt(oldTC);
		TCsecs = timecode;
			
		var hours = pad(Math.floor(TCsecs / 3600), 2);
		var divisor_for_minutes = TCsecs % (3600);
		var minutes = pad(Math.floor(divisor_for_minutes / 60), 2);
		var divisor_for_seconds = divisor_for_minutes % 60;
		var seconds = pad(Math.ceil(divisor_for_seconds), 2);
		var miliseconds = pad( parseInt((oldTC - timecode) * 1000), 3);
		
		return hours + ':' + minutes + ':' + seconds + ',' + miliseconds;        
}
function convertTC_SRTtoNative(oldTC) {
	// Should probably verify the format is correct.
	if (oldTC.trim() == "")
		return Number.POSITIVE_INFINITY;

	var h=parseInt(oldTC.substr(0,2)) * 60 * 60;
	var m=parseInt(oldTC.substr(3,2)) * 60;
	var s=parseInt(oldTC.substr(6,2));
	var ms=parseInt(oldTC.substr(9,3))/1000;

	return h+m+s+ms;
}

function validTimecode(TC) {
	if (TC.trim() == "")
		return false;
		
	var pat=/\d\d:\d\d:\d\d,\d\d\d/;
	var newTC=pat.exec(TC);
	
	if (TC != newTC)
		return false
		
	return true
}

function resetStatus() {
	updateStatusMessage("");
}
function toggleArrows() {
	var obj=document.getElementById("toggleArrows");
	if (obj.innerHTML == "ON") {
		obj.innerHTML = "OFF";
		obj.parentNode.style.backgroundColor = "";
	} else {
		obj.innerHTML = "ON";
		obj.parentNode.style.backgroundColor = "red";
	}
}

function updateStatusMessage(message) {
	document.getElementById("statusMessage").innerHTML=message;
}

function detectTimecodeOverlap(row, curIn, curOut) {
	var overlap=-1;
	
	// Make sure the IN and OUT points are out of bounds for the video clip first.
	var videoTag = document.getElementById("video");
	var limit=videoTag.duration;	
	if (curIn < 0 || curOut < 0 || curIn > limit || curOut > limit)
		return 0;
		
	for (var i=1; i < CURRENT_ROW; i++) {
		// Don't check itself
		if (row==i)
			continue;
			
		IN=getTimecodeNative("IN",i);
		OUT=getTimecodeNative("OUT",i);
		// Ensure neither IN and OUT points don't fall between any others already existing in the project
		// Because an IN point can legally be the same value as an OUT point and vice versa we only check
		// 	for equality on newIN vs existing INs and newOUT vs exisints OUTs
		
		// First check to make sure we don't move inside another subtitle
		if (curIn >= IN && curIn < OUT) 
			return i;
		if (curOut > IN && curOut <= OUT)
			return i;
		
		// Then check to make sure another subtitle didn't move inside us
		// This can happen when moving a long subtitle next to a short one. The short one gets inside the long one even though we're
		// the long one.
		if (IN >= curIn && IN < curOut)
			return i;
		if (OUT > curOut && OUT <= curOut)
			return i;
	}
	
	return overlap;
}

function findChronologicalInsertionPoint(inPoint) {
	var insertAt=0; // Insert at the beginning by default unless we find a better spot
	var foundSpot=false;
	
	for (var i=CURRENT_ROW - 1 ; i > 0; i--) {
		if (inPoint > getTimecodeNative("IN", i)) {
			insertAt=i+1;
			foundSpot=true;
			break;
		}
	} 
	
	// Check if we are still going to insert at the end. If so set back to -1
	// because then we don't need to call updateIDs() and saves a bit of time...
	if (insertAt == CURRENT_ROW && foundSpot)
		insertAt=-1;
			
	return insertAt;
}

function addSub(insertAt) {
	var inPoint=getTimecode("IN",0);
	var inPointNative=getTimecodeNative("IN",0);
	var outPoint=getTimecode("OUT",0);
	var outPointNative=getTimecodeNative("OUT",0);
		
	var overlapRow=detectTimecodeOverlap(0, inPointNative, outPointNative);
	if (overlapRow != -1) {
		updateStatusMessage("You can't add a subtitle that has timecode overlaping... Conflicts with row:" + overlapRow);
		return;
	}
		
	if (validTimecode(inPoint) == false) {
		updateStatusMessage("Invalid Timecode in your current IN point");
		return;
	}

	if (validTimecode(outPoint) == false) {
		updateStatusMessage("Invalid Timecode in your current OUT point");
		return;
	}	
		
	if ( inPointNative >= outPointNative ) {
		updateStatusMessage("You can't set an IN point after an OUT point!");
		return;
	}
	
	var row=document.createElement("tr");
	row.id="ROW" + CURRENT_ROW;
	var td, input;
	var event = new Event('change');
	
	td=document.createElement("td"); td.className="checkbox";
	input=document.createElement("input"); 
	input.type="checkbox"; input.id="BOX" + CURRENT_ROW;
	input.addEventListener('click', selectCheckBox);	
	td.appendChild(input);
	row.appendChild(td);
	
	
	td=document.createElement("td"); td.className="timecode";
	input=document.createElement("input");
	input.addEventListener('change', updateNativeTimecode);	
	input.type="text"; input.id="IN" + CURRENT_ROW;
	input.setAttribute("beforeSlide", "null");
	input.className="timecodeInput"; input.value=inPoint;	
	input.dispatchEvent(event);
	td.appendChild(input);	
		
	input=document.createElement("br");
	td.appendChild(input);
	input=document.createElement("input");
	input.type="range"; input.id="SHIFT" + CURRENT_ROW;
	input.setAttribute("min", "-1.5"); input.setAttribute("max", "1.5"); 
	input.setAttribute("step", "0.025"); input.className="shiftSubtitle"; input.value="0";
	input.addEventListener('input', shiftSub);	input.addEventListener('change', shiftSubFinalize);	
	td.appendChild(input);
	row.appendChild(td);
	
	td=document.createElement("td"); td.className="timecode";
	input=document.createElement("input");
	input.addEventListener('change', updateNativeTimecode);		
	input.type="text"; input.id="OUT" + CURRENT_ROW;
	input.setAttribute("beforeSlide", "null");	
	input.className="timecodeInput"; input.value=outPoint;	
	input.dispatchEvent(event);		
	td.appendChild(input);
	
	input=document.createElement("br");
	td.appendChild(input);
	input=document.createElement("button"); input.className="splitSubtitle";
	input.innerText="Split Sub"; input.id="SPLIT" + CURRENT_ROW;
	input.addEventListener('click', splitSub);
	td.appendChild(input);
	
	row.appendChild(td);
	
	td=document.createElement("td"); td.className="subtitle";
	input=document.createElement("textarea");
	input.addEventListener('change', resetDisplayedSubtitle);		
	input.type="text"; input.id="SUB" + CURRENT_ROW;
	input.className="subtitleInput"; input.value=getSubtitle(0);	
	td.appendChild(input);
	row.appendChild(td);
	
	// If we don't specific a specific insertion point then insert in a spot to keep them in chronological order
	if (insertAt == -1)
		insertAt=findChronologicalInsertionPoint(inPointNative);
	
	// Either inserts the subtitle at the end or inserts directly after row "insertAfter"	
	if (insertAt == -1)			
		document.getElementById("subtitles").appendChild(row);
	else {
		var table=document.getElementById("subtitles");
		var insertPoint; 
		if (insertAt == 0)
			insertPoint=table.firstChild;
		else
			insertPoint=document.getElementById("ROW" + insertAt);
			
		table.insertBefore(row, insertPoint);	
		// Since we are inserting in the middle of the table we need to update all the IDs
		updateIDs();
	}
	CURRENT_ROW++;

	setTimecode("IN", 0, outPoint);
	setTimecode("OUT", 0, "");
	setSubtitle(0, "");
}
function deleteSubs(event) {
	var table=document.getElementById("subtitles");
	
	var numberDeleted=0;
	// Start at 1 because 0 is the user input row
	for (var i=1; i < CURRENT_ROW; i++) {
		if (document.getElementById("BOX"+i).checked) {
			table.deleteRow(document.getElementById("ROW"+i).rowIndex);
			numberDeleted++;
		}
	}

	// If we didn't actually delete anything here is no reason to update the table ID values
	if (numberDeleted == 0)
		return;
		
	/* Reset index values to ensure random access via document.getElementById("IN" + index) still function. Otherwise we might have gaps
		and if you loop from 0 to CURRENT_ROW document.getElementById("IN" + index) might be null. 
	
		So when we erase rows we just remove the gaps so everything else functions normally and we don't have to constantly check that
		references exist because we ensure they do.
	*/
	updateIDs();
	
	// Never actually 0 because we always count our data entry line
	CURRENT_ROW=table.rows.length + 1;
		
	// Since we deleted rows let's refresh the current subtitle being displayed in case it deleted
	resetDisplayedSubtitle();
	
	// Reset the status of the "Select All" checkbox because it shouldn't be checked if the user deleted the selection already.
	document.getElementById("selectAllCheckbox").checked="";
}
function splitSub(event) {
	var row=parseInt(event.target.id.slice(5));
	var table = document.getElementById("subtitles");
	
	// In order to reuse addSub() code we have to backup the values because it resets them after adding a sub.
	var tempIn=getTimecode("IN", 0);
	var tempOut=getTimecode("OUT", 0);
	var tempSub=getSubtitle(0);
	
	var halfWayPoint=(getTimecodeNative("OUT", row) - getTimecodeNative("IN", row)) / 2;
	setTimecodeNative("IN", 0, getTimecodeNative("IN", row) + halfWayPoint);
	setTimecodeNative("OUT", 0, getTimecodeNative("OUT", row));
	setSubtitle(0, getSubtitle(row));
	
	setTimecodeNative("OUT", row, getTimecodeNative("IN", row) + halfWayPoint);
	addSub(row);
	
	// Restore backups
	setTimecode("IN", 0, tempIn);
	setTimecode("OUT", 0, tempOut);
	setSubtitle(0, tempSub);
}

function shiftSub(event) {
	var row=parseInt(event.target.id.slice(5));
	var curIn=getTimecodeNative("IN",row);
	var curOut=getTimecodeNative("OUT",row);

	var oldIn=document.getElementById("IN" + row).getAttribute("beforeSlide");
	var oldOut=document.getElementById("OUT" + row).getAttribute("beforeSlide");

	if ( isNaN(oldIn)  && isNaN(oldOut)  ) {
		document.getElementById("IN" + row).setAttribute("beforeSlide", curIn);
		document.getElementById("OUT" + row).setAttribute("beforeSlide", curOut);
		oldIn=curIn;
		oldOut=curOut;
	}
	
	var inP=getTimecode("IN", row);
	var outP=getTimecode("OUT", row);
	if (!validTimecode(inP) || !validTimecode(outP)) {
		updateStatusMessage("Invalid or missing timecode in IN/OUT point. Unable to shift.");
		event.target.value="0";
		return;
	}
	var newIn=Number(oldIn);
	var newOut=Number(oldOut)	
	var videoTag=document.getElementById("video");
	console.log("Shift:" + videoTag.getAttribute("shiftKey") + " Alt:" + videoTag.getAttribute("altKey"));	
	if (videoTag.getAttribute("altKey") != "true")
		newIn=newIn + Number(event.target.value);
	if (videoTag.getAttribute("shiftKey") != "true")
		newOut=newOut + Number(event.target.value);
		
	if (newIn < 0) {
		newOut=newOut - newIn; // Do this to keep the subtitle the same total duration
		newIn = 0;
	}
	var videoTag=document.getElementById("video");
	if (newOut > videoTag.duration) {
		newIn=newOut - newIn; // Do this to keep the subtitle the same total duration
		newOut=videoTag.duration;
	}
	
	setTimecodeNative("IN", row, newIn);
	setTimecodeNative("OUT", row, newOut);	
	
	forceDraw();
}
function shiftSubFinalize(event) {
	var row=parseInt(event.target.id.slice(5));	
	var curIn=getTimecodeNative("IN",row);
	var curOut=getTimecodeNative("OUT",row);
	var oldIn=document.getElementById("IN" + row).getAttribute("beforeSlide");
	var oldOut=document.getElementById("OUT" + row).getAttribute("beforeSlide");
			
	var collideSub=detectTimecodeOverlap(row, curIn, curOut);
	if (collideSub != -1) {
		updateStatusMessage("Colliding with subtitle in row: " + collideSub);
		setTimecodeNative("IN", row, oldIn);
		setTimecodeNative("OUT", row, oldOut);
	} 
	
	document.getElementById("IN" + row).setAttribute("beforeSlide", "null");
	document.getElementById("OUT" + row).setAttribute("beforeSlide", "null");
	event.target.value="0";
	
	forceDraw();
}

function updateIDs() {
	var table=document.getElementById("subtitles");
	// The +1 is because ROW0, BOX0, IN0, OUT0, & SUB0 are in the other table
		for (var i=0; i < table.rows.length; i++) {
		offset=i+1;
		fromTableRowIndex_getCheckbox(table,i).id="BOX"+offset;
		fromTableRowIndex_getInPoint(table,i).id="IN"+offset;
		fromTableRowIndex_getOutPoint(table,i).id="OUT"+offset;
		fromTableRowIndex_getSubtitle(table,i).id="SUB"+offset;
		fromTableRowIndex_getShiftSub(table,i).id="SHIFT"+offset;
		fromTableRowIndex_getSplitSub(table,i).id="SPLIT"+offset;
		table.rows[i].id="ROW"+offset;
	}
}

function offsetSubs() {
	// TODO: Make sure IN points don't pass OUT points and OUT points don't pass IN points... UGH!
	var applyOffset=true;
	var videoTag = document.getElementById("video");
	var limit=videoTag.duration;
	var applyTo=document.getElementById("offsetType").value;
	var amount=Number(document.getElementById("offsetAmount").value);
	var problemRows="";
	
	if (isNaN(amount)) {
		updateStatusMessage("Offset is not a valid number.");
		return;
	}
	
	// Step 1: Make sure the offsets don't push any values outside of the video range
	for (var i=1; i < CURRENT_ROW; i++) {
		if (document.getElementById("BOX"+i).checked) {
			if (applyTo == "IN" || applyTo == "BOTH") {
				newValue=getTimecodeNative("IN", i) + amount;
				if (newValue < 0 || newValue > limit) {
					applyOffset=false;
					problemRows += i + " ";
				}
			}
			problemRows += "\n";
			if (applyTo == "OUT" || applyTo == "BOTH") {
				newValue=getTimecodeNative("OUT", i) + amount;
				if (newValue < 0 || newValue > limit) {
					applyOffset=false;
					problemRows += i + " ";
				}			
			}	
		}
	}


	// TODO: Parse problemRows to display a detailed status message and/or highlight problem rows
	if (applyOffset == false) {
		updateStatusMessage("Unable to offset timecode for selections");
		console.log(problemRows);
		return;		
	}
	
	// Step 2: Make the changes to the timecode
	for (var i=1; i < CURRENT_ROW; i++) {
		if (document.getElementById("BOX"+i).checked) {
			if (applyTo == "IN" || applyTo == "BOTH") {
				newValue=convertTC_NativetoSRT(getTimecodeNative("IN", i) + amount);
				setTimecode("IN", i, newValue);
			}
			problemRows += "\n";
			if (applyTo == "OUT" || applyTo == "BOTH") {
				newValue=convertTC_NativetoSRT(getTimecodeNative("OUT", i) + amount);
				setTimecode("OUT", i, newValue);			
			}	
		}
	}	
	
	forceDraw();	
}

function forceDraw() {
	document.getElementById("video").setAttribute("forceRedraw", true);
}

function fromTableRowIndex_getCheckbox(table, row) {
	return table.rows[row].cells[0].firstChild;
}
function fromTableRowIndex_getInPoint(table, row) {
	return table.rows[row].cells[1].firstChild;
}
function fromTableRowIndex_getOutPoint(table, row) {
	return table.rows[row].cells[2].firstChild;
}
function fromTableRowIndex_getSubtitle(table, row) {
	return table.rows[row].cells[3].firstChild;
}
function fromTableRowIndex_getShiftSub(table, row) {
	return table.rows[row].cells[1].lastChild;
}
function fromTableRowIndex_getSplitSub(table, row) {
	return table.rows[row].cells[2].lastChild;
}

function rewind() {
	// Updated to allow you to rapidly hit tab to seek back multiple in points.
	var videoTag = document.getElementById("video");
	var time=videoTag.currentTime;
	
	var index=getClosestPointFromTime("IN", time, false, 1.0);
	if (index != -1) {
		videoTag.currentTime=getTimecodeNative("IN", index);
	}
	else
		videoTag.currentTime=0;	
}

function changePlayRate(rate) {
	var videoTag = document.getElementById("video");
	
	// Adjust by 10% speed for each step
	videoTag.playbackRate=1+(.1*rate);	
}

function selectAll(checkBox) {
		var state=checkBox.checked;
		
		var table=document.getElementById("subtitles");
		for (var i=0; i < table.rows.length; i++) {
			fromTableRowIndex_getCheckbox(table,i).checked=state;
		}	
}
function selectCheckBox(event) {	
	if (event.shiftKey==true && LAST_BOX != -1) {
		var curBox=parseInt(event.target.id.slice(3));
		var L,H;
		var state=document.getElementById("BOX"+LAST_BOX).checked;
		
		if (curBox > LAST_BOX) {
			L=LAST_BOX;
			H=curBox;
		} else {
			L=curBox;
			H=LAST_BOX;
		}
		for (var i=L; i < H; i++) {
			document.getElementById("BOX"+i).checked=state;
		}
	}
	LAST_BOX=parseInt(event.target.id.slice(3));	
}

function getIndexForSurroundingTime(nativeTC) {
	var index=-1;
	var videoTag = document.getElementById("video");
	var time=videoTag.currentTime;
	
	// Start at 1 because 0 is the in "Enter Subtitles Here" section and we don't want to look at that one	
	for (var i=1; i < CURRENT_ROW; i++) {
		IN=getTimecodeNative("IN",i);
		OUT=getTimecodeNative("OUT",i);
		
		if (getTimecode("IN", i) == "") {
			var index2=getClosestPointFromTime("OUT", time, false);
			if (index2 != -1)
				IN=getTimecodeNative("OUT", index2); 			
		}
		if (getTimecode("OUT", i) == "") {
			var index2=getClosestPointFromTime("IN", time, true);
			if (index2 != -1)
				IN=getTimecodeNative("IN", index2);
			else
				OUT=Number.POSITIVE_INFINITY;	 			
		}		
		if (nativeTC >= IN && nativeTC <= OUT) {
			return i;
		}
	}
	
	return index;
}
function getClosestPointFromTime(point, nativeTC, forward, margin) {
	// TODO: Explain the margin
	if (margin==undefined) margin=0.0;
	
	var P;
	var currentBest=Number.POSITIVE_INFINITY;
	var currentBestIndex=-1;
	var current=0;
	
	var time=Number(nativeTC);
		
	for (var i=0; i < CURRENT_ROW; i++) {
		if (i == 0 && getTimecode(point, i) == "")
			continue;
			
		P=getTimecodeNative(point,i);
		if (forward)
			current=P-time;
		else
			current=time-P;
			
		if (current > (0.0 + margin) && current < currentBest) {
			currentBest=current;
			currentBestIndex=i;
		}	
	}
	
	return currentBestIndex;
}

function dragWaveform(event) {
	var canvas=document.getElementById("waveformPreview");
	if (event.button == 1 || event.which == 1) {
		var lastValue=canvas.getAttribute("data-lastPosition");
		if (isNaN(lastValue)) {
			canvas.setAttribute("data-lastPosition", event.x);
		} else {
			var adjust = (lastValue - event.x) / LINES_PER_SECOND;
			if (event.shiftKey == true)
				adjust=adjust*10;
			var videoTag=document.getElementById("video");
			console.log(adjust);
			videoTag.currentTime = videoTag.currentTime + adjust;
			canvas.setAttribute("data-lastPosition", event.x);
			forceDraw();
		}
	} else {
		canvas.setAttribute("data-lastPosition", null);
	}
}

function processKeyboardInput(event) {
	resetStatus();
	
	var videoTag=document.getElementById("video");
	switch(event.keyCode) {
		case 9: processTab(event); 			break;
		case 13: processEnter(event); 		break;
		
		case 38: processUpArrow(event); 	break;
		case 40: processDownArrow(event); 	break;
		
		case 37: processLeftArrow(event);	break;
		case 39: processRightArrow(event);	break;
		
		case 112: // F1 Key
			if (document.getElementById("instructionsContainer").style.display == "block")
		 		hideInstructions(); 
		 	else 
		 		showInstructions();
		 	break; 
		
		case 27: // Escape key
			if (videoTag.paused)
				videoTag.play();
			else
				videoTag.pause();
			break;

		case 17: // Control Key + Alt Key Down
			if (event.altKey == true) {
				event.preventDefault();
				toggleArrows();
			}
			break;
		case 18: // Alt key + Control Key Down
			if (event.ctrlKey == true) {
				event.preventDefault();
				toggleArrows();
			}
			break;			
	}
	
	// Keep track of what modifier keys are up/down for the slider controls so they know to only modify IN or OUT points
	var videoTag=document.getElementById("video");
	if (event.shiftKey == true)
		videoTag.setAttribute("shiftKey", "true");	
	if (event.altKey == true)
		videoTag.setAttribute("altKey", "true");

	forceDraw();	
}
function processKeyboardInputKeyUp(event) {
	var videoTag=document.getElementById("video");
	switch(event.keyCode) {
		case 16: // Shift key up
			videoTag.setAttribute("shiftKey", "false");	break;
		case 18: // Alt Key Up
			videoTag.setAttribute("altKey", "false"); break;
	}
}

function processTab(event) {
	// If we're not in IN0, OUT0, or SUB0 then TAB shouldn't do anything but the normal behavior
	if ( document.getElementById("currentInput").contains(document.activeElement) == false)
			return;
		
	// Prevent TAB for jumping out of the currentSubtitle input
	if (document.activeElement == document.getElementById("SUB0")) 
		event.preventDefault();
		
	var videoTag = document.getElementById("video");
	if (videoTag.readyState != 4) {
		updateStatusMessage("No video file loaded!");
		return;
	}
	
	if (event.shiftKey==true) {
		setTimecode("IN", 0, "");
		return;
	}

	if (getTimecode("IN", 0) == "") {
		setTimecode("IN", 0, document.getElementById("currentTimecode").innerHTML);
		return;
	}
	else 
		rewind();
}
function processEnter(event) {
	// If we're not in IN0, OUT0, or SUB0 then TAB shouldn't do anything but the normal behavior
	if ( document.getElementById("currentInput").contains(document.activeElement) == false)
			return;
			
	// Prevent ENTER from adding a newline to SUB0 
	if (document.activeElement == document.getElementById("OUT0")) 
		event.preventDefault();
		
	var videoTag = document.getElementById("video");
	if (videoTag.readyState != 4) {
		updateStatusMessage("No video file loaded!");
		return;
	}
	
	// CTRL + ENTER clears the OUT point
	if (event.ctrlKey==true) {
		event.preventDefault();
		setTimecode("OUT", 0, "");
		return;
	}	

	// 
	if (event.shiftKey==false) {
		// Prevent SHIFT+ENTER from adding a newline in the currentSubtitle input
		if (document.activeElement == document.getElementById("SUB0")) 
			event.preventDefault();	
			
		var currentIn=document.getElementById("IN0");
		var currentOut=document.getElementById("OUT0");
	
		if (getTimecode("IN", 0) == "") {
			updateStatusMessage("No In Point Set!");
			return;
		}
	
		var currentOut=getTimecode("OUT", 0);
		if (currentOut != "" && validTimecode(currentOut) == false) {
			updateStatusMessage("Invalid Timecode in your current OUT point");
			return;
		}		
		else if (currentOut == "") {
			setTimecode("OUT", 0, document.getElementById("currentTimecode").innerHTML);
			document.getElementById("SUB0").focus();
			return;
		}
	
		addSub(-1);
	}
}
function processUpArrow(event) {
	// This key should perform it's normal behavior unless toggleArrows == "On" or the user doesn't have an active element in right side or bottom of the UI
	var bottom=document.getElementById("bottom").contains(document.activeElement);
	var rightSide=document.getElementById("rightSide").contains(document.activeElement);
	var toggleArrows=document.getElementById("toggleArrows").innerHTML.toUpperCase();

	if (toggleArrows == "OFF" && (bottom || rightSide) )
		return;
		
	event.preventDefault();

	var videoTag = document.getElementById("video");
	if (videoTag.readyState != 4) {
		updateStatusMessage("No video file loaded!");
		return;
	}
			
	var videoTag = document.getElementById("video");
	var time=videoTag.currentTime;
	
	var index=getIndexForSurroundingTime(time);
	var oldTime, newTime;
	newTime=convertTC_NativetoSRT(time);
			
	if (index != -1) { // Move OUT point from RIGHT of currentTime to currentTime
		oldTime=getTimecode("OUT", index);
		setTimecode("OUT", index, newTime );
		
		// If the previous IN point time was the same as the OUT point we just moved let's also adjust it
		if (event.shiftKey==false) {
			var oIndex=getIndexFromTimecode("IN", oldTime);
			if (oIndex != -1 ) {
				setTimecode("IN", oIndex, newTime); 
			}
		}
	} else { // Move OUT point on the left of currentTime to currentTime
		index=getClosestPointFromTime("OUT", time, false);
		if (index != -1) {
			setTimecode("OUT", index, newTime );
		}
	}
	resetDisplayedSubtitle();	
}
function processDownArrow(event) {
	// This key should perform it's normal behavior unless toggleArrows == "On" or the user doesn't have an active element in right side or bottom of the UI
	var bottom=document.getElementById("bottom").contains(document.activeElement);
	var rightSide=document.getElementById("rightSide").contains(document.activeElement);
	var toggleArrows=document.getElementById("toggleArrows").innerHTML.toUpperCase();

	if (toggleArrows == "OFF" && (bottom || rightSide) )
		return;
			
	event.preventDefault();

	var videoTag = document.getElementById("video");
	if (videoTag.readyState != 4) {
		updateStatusMessage("No video file loaded!");
		return;
	}
		
	var videoTag = document.getElementById("video");
	var time=videoTag.currentTime;
	
	var index=getIndexForSurroundingTime(time);
	var oldTime, newTime;
	newTime=convertTC_NativetoSRT(time);
			
	if (index != -1) { // Move IN point from LEFT of currentTime to currentTime
		oldTime=getTimecode("IN", index);
		setTimecode("IN", index, newTime );
		
		// If the previous OUT point time was the same as the IN point we just moved let's also adjust it
		if (event.shiftKey==false) {
			var oIndex=getIndexFromTimecode("OUT", oldTime);
			if (oIndex != -1 ) {
				setTimecode("OUT", oIndex, newTime); 
			}
		}
	} else { // Move IN point on the right of currentTime to currentTime
		index=getClosestPointFromTime("IN", time, true);
		if (index != -1) {
			setTimecode("IN", index, newTime );
		}
	}
	resetDisplayedSubtitle();		
}
function processLeftArrow(event) {
	// This key should perform it's normal behavior unless toggleArrows == "On" or the user doesn't have an active element in right side or bottom of the UI
	var bottom=document.getElementById("bottom").contains(document.activeElement);
	var rightSide=document.getElementById("rightSide").contains(document.activeElement);
	var toggleArrows=document.getElementById("toggleArrows").innerHTML.toUpperCase();

	if (toggleArrows == "OFF" && (bottom || rightSide) )
		return;
			
	event.preventDefault();

	var videoTag = document.getElementById("video");
	if (videoTag.readyState != 4) {
		updateStatusMessage("No video file loaded!");
		return;
	}
			
	var videoTag = document.getElementById("video");
	var time=videoTag.currentTime;
	
	var index=getClosestPointFromTime("IN", time, false, 1.0);
	if (index != -1) {
		videoTag.currentTime=getTimecodeNative("IN", index);
	}
	else
		videoTag.currentTime=0;

	resetDisplayedSubtitle();	
}
function processRightArrow(event) {
	// This key should perform it's normal behavior unless toggleArrows == "On" or the user doesn't have an active element in right side or bottom of the UI
	var bottom=document.getElementById("bottom").contains(document.activeElement);
	var rightSide=document.getElementById("rightSide").contains(document.activeElement);
	var toggleArrows=document.getElementById("toggleArrows").innerHTML.toUpperCase();

	if (toggleArrows == "OFF" && (bottom || rightSide) )
		return;
			
	event.preventDefault();

	var videoTag = document.getElementById("video");
	if (videoTag.readyState != 4) {
		updateStatusMessage("No video file loaded!");
		return;
	}
	
	var videoTag = document.getElementById("video");
	var time=videoTag.currentTime;
	
	var index=getClosestPointFromTime("IN", time, true);
	if (index != -1) {
		videoTag.currentTime=getTimecodeNative("IN", index);
	}
	else
		videoTag.currentTime=videoTag.duration;
	
	resetDisplayedSubtitle();	
}


