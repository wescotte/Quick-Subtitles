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
	offsetSubs() could use some work...
		Make error messages displayed in a more friendly way and perhaps highlight subtitle rows with problems
		
	addSub() checks for conflicts and reports them. However, if there is a problem it still creates an undo/redo state
		which isn't necessary.. 
		
	undo/redo sometimes produces strange errors in the console... Not sure why.
		It appears to be a caching/garbage collector issue in Chrome because if you delete a group of rows
		and then "undo it" they will keep the checkbox flag which shouldn't be occur because we're creating these
		elements from scratch when we "undo" them.
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

var undoBuffer;
var undoBufferSize=100;
var undoPosition=0;

function init() {
	setupUndoBuffer();
	
	// Setup all the event listeners
	document.getElementById("showInstructions").addEventListener("click", showInstructions);
	document.getElementById("hideInstructions").addEventListener("click", hideInstructions);		

	document.getElementById("saveSubtitles").addEventListener("click", saveSRTFile);
	document.getElementById("exportSubtitles").addEventListener("click", exportSTL);	

	// These two are used to hide the default button for <input type="file"...> 
	//	When they are clicked we just push a click event to the hidden elements
	document.getElementById("BTNvideoLoad").addEventListener("click", 
		function() { var event = new Event("click"); document.getElementById('loadVideo').dispatchEvent(event); }
	);
	document.getElementById("BTNsubtitleLoad").addEventListener("click", 
		function() { var event = new Event("click"); document.getElementById('loadSubtitles').dispatchEvent(event); }
	);	
			
	document.getElementById("BTNappyOffet").addEventListener("click", offsetSubs);	
	document.getElementById("deleteSubs").addEventListener("click", deleteSubs);		
	document.getElementById("selectAllCheckbox").addEventListener("click", selectAll);						
					
	document.getElementById("BTNsetInPoint").addEventListener("click", BTNsetInPoint);
	document.getElementById("BTNsetOutPoint").addEventListener("click", BTNsetOutPoint);
	document.getElementById("BTNclearInPoint").addEventListener("click", BTNclearInPoint);
	document.getElementById("BTNclearOutPoint").addEventListener("click", BTNclearOutPoint);	
	document.getElementById("BTNaddSubtitle").addEventListener("click", BTNaddSubtitle);	
	document.getElementById("BTNundo").addEventListener("click", BTNundo);	
	document.getElementById("BTNredo").addEventListener("click", BTNredo);	
				
	document.getElementById("playRate").addEventListener("change", changePlayRate);
	document.getElementById("fontSize").addEventListener("change", updateFontSize);
	document.getElementById("fontColor").addEventListener("change", updateFontColor);
	document.getElementById("bgOpacity").addEventListener("change", updateFontBackgroundOpacity);	
	document.getElementById("bgColor").addEventListener("change", updateFontBackgroundColor);
	
	
	// Setup the font settings values
	var overlay=document.getElementById("overlaySubtitle");
	var style=window.getComputedStyle(overlay);
	document.getElementById("fontColor").value=makeColorFromString(style.getPropertyValue('color'));
	document.getElementById("bgColor").value=makeColorFromString(style.getPropertyValue('background-color'));
	var fontSize=style.getPropertyValue("font-size");
	fontSize=fontSize.replace("px", "");
	document.getElementById("fontSize").value=fontSize;
	document.getElementById("bgOpacity").value=parseFloat(style.getPropertyValue("opacity")).toFixed(2);
		
	var loadVideo = document.getElementById('loadVideo');
	var loadSubtitles = document.getElementById("loadSubtitles");
	var saveSubtitles = document.getElementById("saveSubtitles");
		
	var URL = window.URL || window.webkitURL
	if (!URL) {
		updateStatusMessage('Your browser is not ' + 
						'<a href="http://caniuse.com/bloburls">supported</a>!');
	} else {    
		loadVideo.addEventListener('change', playSelectedFileInit, false);
		loadSubtitles.addEventListener('change', loadSRTFile, false);	
		document.addEventListener('keydown', processKeyboardInput);
		document.addEventListener('keyup', processKeyboardInputKeyUp);
		
		document.getElementById("IN0").addEventListener('change', updateNativeTimecode);
		document.getElementById("OUT0").addEventListener('change', updateNativeTimecode);
		document.getElementById("SUB0").addEventListener('input', updateSubtitle);	
		document.getElementById("SUB0").addEventListener('change', resetDisplayedSubtitle);
		var shift0=document.getElementById("SHIFT0");
		shift0.addEventListener('input', shiftSub);	
		shift0.addEventListener('change', shiftSubFinalize);
		
		document.getElementById("waveformPreview").addEventListener("mousemove", dragWaveform);						
	}
}
function playSelectedFileInit(event) {
	var file = this.files[0];
	if(typeof(file)==='undefined') {
		updateStatusMessage("Warning: Unable to load file.");
		return;
	}
	
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

	// We have to ensure the video is actually loaded before we attempt to generate a waveform
	setTimeout(checkReady, 250);			
}

function BTNsetInPoint(event) {
	resetStatus();
	var videoTag = document.getElementById("video");
	if (videoTag.readyState != 4) {
		updateStatusMessage("No video file loaded!");
		return;
	}
	
	var curTime=videoTag.currentTime;
	if (getTimecodeNative("OUT", 0) <= curTime) {
		updateStatusMessage("Error: You can't set an IN point after an OUT point.");
		return;
	}
		
	setTimecode("IN", 0, document.getElementById("currentTimecode").innerHTML);
	
	forceDraw();
}
function BTNsetOutPoint(event) {
	resetStatus();
	var videoTag = document.getElementById("video");
	if (videoTag.readyState != 4) {
		updateStatusMessage("No video file loaded!");
		return;
	}
	
	var curTime=videoTag.currentTime;
	if (getTimecodeNative("IN", 0) >= curTime) {
		updateStatusMessage("Error: You can't set an OUT point before an IN point.");
		return;
	}
	
	setTimecode("OUT", 0, document.getElementById("currentTimecode").innerHTML);
	
	forceDraw();
}
function BTNclearInPoint(event) {
	resetStatus();
	setTimecode("IN", 0, "");
	forceDraw();	
}
function BTNclearOutPoint(event) {
	resetStatus();
	setTimecode("OUT", 0, "");
	forceDraw();	
}
function BTNaddSubtitle(event) {
	resetStatus();
	
	var currentIn=getTimecode("IN", 0);
	var currentOut=getTimecode("OUT", 0);
	
	if (currentIn != "" && validTimecode(currentIn) == false) {
		updateStatusMessage("Invalid Timecode in your current IN point");
		return;
	}			
	if (currentOut != "" && validTimecode(currentOut) == false) {
		updateStatusMessage("Invalid Timecode in your current OUT point");
		return;
	}		

	var inPointNative=getTimecodeNative("IN",0);
	var outPointNative=getTimecodeNative("OUT",0);
		
	var overlapRow=detectTimecodeOverlap(0, inPointNative, outPointNative);
	if (overlapRow != -1) {
		updateStatusMessage("You can't add a subtitle that has timecode overlaping... Conflicts with row:" + overlapRow);
		return;
	}
	
	var tempOut=getTimecode("OUT", 0);
	createUndoState("STARTBUFFER", 0, true);			
	createUndoState("CU", 0, true, true);
	addSub(-1, true, true);
	// TODO: Add a flag so the user can enable/disable automatically setting this IN point after adding a subtitle
	setTimecode("IN", 0, tempOut, false);	
	createUndoState("CR", 0, true, true);		
	createUndoState("ENDBUFFER", 0, true);
	
	forceDraw();		
}
function BTNundo(event) {
	resetStatus();
	undo();
	forceDraw();	
}
function BTNredo(event) {
	resetStatus();
	redo();
	forceDraw();	
}

function setupUndoBuffer() {
	undoBuffer=new Array();
}
function createUndoState(type, row, appendState) {
	if(typeof(appendState)==='undefined') {
		appendState = false;
	}

	/*	When creating a state it should always be the most recent event. If any exist after it we have to clear them
		else risk losing sync.. This occurs when you undo several times, do something "new", and then attempt to redo.
		After you do something "new" all states after it should be cleared as you're creating a new branch at that point */
	if (undoPosition+1 < undoBufferSize) {
		undoBuffer[undoPosition+1]=null;
		undoBuffer=undoBuffer.splice(0,undoPosition+2);	
	}

	if (undoBuffer[undoPosition] == null || appendState == false || type == "STARTBUFFER") {
		undoBuffer[undoPosition]=new Array();
		if (type == "STARTBUFFER")
			return;
	}

	// This is because the addSub undoState is initially created using a row <tr>...</tr> contents rather than the custom object
	if (type == "ENDBUFFER") {
		rebuildBuffer();
		appendState=false;
	} else {		
		var undoValue=new Object();
		undoValue.type=type;
		undoValue.row=row;
		undoValue.inP=getTimecode("IN", row);
		undoValue.outP=getTimecode("OUT", row);
		undoValue.subtitle=getSubtitle(row);
	
		undoBuffer[undoPosition].push(undoValue);
	}

	if (!appendState) 	
		nextUndoState();
}
function rebuildBuffer() {
	var IN, OUT, SUB;
	var table=document.getElementById("subtitles");

	updateIDs();
	
	for (var i=0; i < undoBuffer[undoPosition].length; i++) {
		if (undoBuffer[undoPosition][i].type == "REBUILD") {
			var rowIndex=undoBuffer[undoPosition][i].row.rowIndex;
			IN=fromTableRowIndex_getInPoint(table,rowIndex).value;
			OUT=fromTableRowIndex_getOutPoint(table,rowIndex).value;	
			SUB=fromTableRowIndex_getSubtitle(table,rowIndex).value;
		
			var undoValue=new Object();
			undoValue.type="A";
			undoValue.row=Number(undoBuffer[undoPosition][i].row.id.substr(3));
			undoValue.inP=getTimecode("IN", undoValue.row);
			undoValue.outP=getTimecode("OUT", undoValue.row);
			undoValue.subtitle=getSubtitle(undoValue.row);		
		
			undoBuffer[undoPosition][i]=undoValue;	
		}	
	}
}
function undo(event) {
	var lastUndoPosition=undoPosition;
	previousUndoState();

	// Makes sure we don't keep trying to undo the first undoState over and over	
	if (lastUndoPosition == undoPosition) 
		return;
	
	var rebuildIDs=false;
	for (var i=0; i < undoBuffer[undoPosition].length; i++) {
		switch (undoBuffer[undoPosition][i].type) {
			case "CR": break; // ignored for redos		
			case "CU":
			case "C":
				undoChange(undoBuffer[undoPosition][i]); 		break;	
			case "A":
				rebuildIDs=true;
				undoAdd(undoBuffer[undoPosition][i]); 			break;
			case "R":
				rebuildIDs=true;
				undoRemove(undoBuffer[undoPosition][i]);		break;
			default:	// This should never happen but since we're altering a function callback it's a good idea to have
				console.log("INVALID UNDO BUFFER!");
				console.log(undoBuffer[undoPosition][i]);
				updateStatusMessage("INVALID UNDO BUFFER! This should never occur please report this bug.");				
				return;											break;
		}		
	}
	
	if (rebuildIDs)
		updateIDs();
}	
function redo(event) {
	// If no undo/redo state is defined then there is nothing to do
	if (undoBuffer[undoPosition] == null) {
		updateStatusMessage("Nothing to redo");
		return;
	}

	var rebuildIDs=false;			
	for (var i=0; i < undoBuffer[undoPosition].length; i++) {
		switch (undoBuffer[undoPosition][i].type) {
			case "CU": break; // ignored for redos
			case "CR":
			case "C":			
				undoChange(undoBuffer[undoPosition][i]); 		break;	
			case "A":	// Opposite function since when we redo we want to do the opposite of undo
				rebuildIDs=true;
				undoRemove(undoBuffer[undoPosition][i]); 		break;
			case "R":	// Opposite function since when we redo we want to do the opposite of undo
				rebuildIDs=true;
				undoAdd(undoBuffer[undoPosition][i]);			break;
			default:	// This should never happen but since we're altering a function callback it's a good idea to have
				console.log("INVALID REDO BUFFER!");
				console.log(undoBuffer[undoPosition][i]);
				updateStatusMessage("INVALID REDO BUFFER! This should never occur please report this bug.");				
				return;											break;
		}		
	}

	if (rebuildIDs)
		updateIDs();	
			
	nextUndoState();	
}
function nextUndoState() {		
	// If the undo history is too large drop the oldest state
	if (undoPosition >= undoBufferSize) 
		undoBuffer.shift();
	else
		undoPosition++;
}
function previousUndoState() {
	undoPosition--;
		
	if (undoPosition < 0) {
		undoPosition=0;
		updateStatusMessage("Nothing to undo");
	}
}

function undoChange(data) {
	setTimecode("IN", data.row, data.inP, false);
	setTimecode("OUT", data.row, data.outP, false);
	setSubtitle(data.row, data.subtitle, false);
}
function undoAdd(data) {
	if (document.getElementById("ROW"+data.row) == null)
		console.log(data);
	var table=document.getElementById("subtitles");
	var row=document.getElementById("ROW"+data.row).rowIndex;
	table.deleteRow(row);	
	CURRENT_ROW--;
}
function undoRemove(data) {
	setTimecode("IN", 0, data.inP, false);
	setTimecode("OUT", 0, data.outP, false);
	setSubtitle(0, data.subtitle, false);			
	addSub(-1,false, false);	
}

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

	resetStatus();	
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
		
		// Clear the current subtitle so it's not appended to the first sub we load
		setSubtitle(0, "", false, false);
		
		// Start the Undo Buffer State
		createUndoState("STARTBUFFER", 0, true);	
					
		for (var l in lines) {
			line=lines[l];
			counter++;
			if (line.trim() == "") {
				srtStep = 0;
				if (counttext > 0)
				{
					addSub(-1,true, true);
					// addSub() normally clears the subtitle(0) but it won't on failure/time conflict so we should manually have to do it here as well
					setSubtitle(0, "", false);
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
					setTimecode("IN",  0, times[0].trim(), false );
					setTimecode("OUT", 0, times[2].trim(), false );
					srtStep = 2;
				}
			} else if (srtStep == 2) {	
				if (counttext > 0) 
					setSubtitle(0, getSubtitle(0) + "\n", false);
					
				counttext++;
				setSubtitle(0, getSubtitle(0) + line.trim(), false);
				
				// We are on the last line so make sure we add the final subtitle
				if (counter == lines.length)
				{
					addSub(-1,true, true);
					// addSub() normally clears the subtitle(0) but it won't on failure/time conflict so we should manually have to do it here as well			
					setSubtitle(0, "", false);
				}
			}									
		}	
		// Restore current values now that the file is loaded.
		setTimecode("IN", 0, oldIn, false);
		setTimecode("OUT", 0, oldOut, false);
		setSubtitle(0, oldSub, false);		

		// Create undo state for the current subtitle ended in ROW0
		createUndoState("CR", 0, true, true);		
		createUndoState("ENDBUFFER", 0, true);	
		
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
	var FPS;
	if (document.getElementById("STLMode").value == "PAL")
		FPS=25000;
	else
		FPS=30000;
		
	var oneFrame = 1000/(FPS/1001);
	
	return pad(Math.floor(time / oneFrame), 2);
}

function checkReady() {
	var videoTag = document.getElementById("video");
	if (videoTag.readyState === 4)
		generateWaveformPreview();
	else		
		setTimeout(checkReady, 100);
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
	
	// Display Loading Text	
	var ctx=waveformPreview.getContext("2d");
	ctx.font="60px san-serif";
	ctx.fillText("Generating Waveform...",50,80);
		
	var fileReader = new FileReader();
	fileReader.onload = function(e) {
	  	var arrayBuffer = e.target.result;
	  	var audioContext;

		if (typeof AudioContext !== "undefined") {
			audioContext = new AudioContext();
			console.log("not using webkit for audio");
		} else if (typeof webkitAudioContext !== "undefined") {
			audioContext = new webkitAudioContext();
			console.log("using webkit for audio");
		} else {
			throw new Error('AudioContext not supported. :(');
		}	  	

        audioContext.decodeAudioData( arrayBuffer, compressSamples );  
	}
	fileReader.onerror = function(e) {
		ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
		updateStatusMessage("ERROR: Can't read file to generate a waveform preview. Chrome's file API has a bug where it has problems reading big files."
			+ "Try creating a smaller video with a lower bitrate or use a different browser. The sweet spot seems to be anything under 500mb.");
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
//	console.log(PREVIEW_SAMPLES);
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
			// If the OUT point is less than the IN point it's because an OUT point isn't set
			// and we're scrubbing backwards... So in this special case just leave a floating yellow
			// subtitle that is 0.25 long so the user can visually see where it is.
			if (curOut < curIn) {
				curOut=curIn+.25;
				ctx.fillStyle = "rgba(255,255,0,.5)";				
			}
		} else if (curIn <= videoTag.currentTime && curOut >= videoTag.currentTime) {
			ctx.fillStyle = "rgba(0,255,0,.5)";
			draw=true;
			// When subtitle 1's OUT point is the same as subtitle 2's IN point....
			// We only want to to highlight one of the two subtitles green...
			if (i < CURRENT_ROW - 1) {
				var nextIn=getTimecodeNative("IN", i+1);
				if (nextIn == videoTag.currentTime) {
					ctx.fillStyle = "rgba(25,25,25,.5)";
				}
			}	
		} else if ( (curIn >= startTime && curIn <= endTime) || ( curOut >= startTime && curOut <= endTime) ) {
			ctx.fillStyle = "rgba(25,25,25,.5)";			
			draw=true;
			// When the user performs a "Shift Sub" on only the IN or OUT point it's possible to temporarily allow
			//	the IN point come after the OUT point.. The shiftSubFinalize() function won't let it happen
			//	but it will be drawn this way until the user stops dragging the slider.
			if (curIn > curOut)
				ctx.fillStyle = "rgba(255,0,0,.5)";		
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

			ctx.font="10px san-serif";
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
function updateFontSize(event) {
	var s=document.getElementById("fontSize").value;
	
	if (isNaN(s) || s < 0) {
		updateStatusMessage("Invalid font size.. Value must be greater than 0");
	} else {
		document.getElementById("overlaySubtitle").style.fontSize = s + "px";
	}
}
function updateFontColor(event) {
	document.getElementById("overlaySubtitle").style.color=event.target.value;
}
function updateFontBackgroundOpacity(event) {
	var o = document.getElementById("bgOpacity").value;
	
	if (isNaN(o) || (o < 0.0 || o > 1.0)) {
		updateStatusMessage("Invalid opacity... Must be greater than 0.0 >= opacity <= 1.0");
	} else {
		//document.getElementById("overlaySubtitle").style.opacity = o;
	}
	
	var event = new Event('change');
	document.getElementById("bgColor").dispatchEvent(event);
}
function updateFontBackgroundColor(event) {
	var color=event.target.value;
	
	var r = parseInt(color.substr(1,2), 16);
	var g = parseInt(color.substr(3,2), 16);
	var b = parseInt(color.substr(5,2), 16);
	
	var colorString="rgba(" + r + "," + g + ","	+ b + "," + document.getElementById("bgOpacity").value + ")";
	document.getElementById('overlaySubtitle').style.backgroundColor=colorString;
}

function updateOverlayText(newValue) {
	// Change newlines into <br/> so it displays properly in a <p> tag.
	document.getElementById("overlaySubtitle").innerHTML=newValue.replace(/\n/g, "<br/>").trim();
}

function setTimecode(type, row, newValue, createUndo, appendUndoState) {
	var node = document.getElementById(type + row);
	if(typeof(createUndo)==='undefined') 
		createUndo = true;
	if(typeof(appendUndoState)==='undefined') 
		appendUndoState = false;	
		
	if (createUndo) {
		if (appendUndoState == false)
			createUndoState("STARTBUFFER", 0, true);		
		createUndoState("CU", row, true);	
	}		
	if (node == null) {
		updateStatusMessage("ERROR! Unable to set timecode: " + newValue + " for " + type + " point for row: " + row);
		console.log("ERROR! Unable to set subtitle value for row: " + row + " Here is a table dump");
		console.log(document.getElementById("subtitles"));
		return;
	}
	
	var changeEvent = new Event('change');
	
	node.value = newValue;
	node.dispatchEvent(changeEvent);

	if (createUndo) {
		createUndoState("CR", row, true);
		if (appendUndoState == false)			
			createUndoState("ENDBUFFER", 0, true);		
	}		
}
function setTimecodeNative(type, row, newValue, createUndo, appendUndoState) {
	var node = document.getElementById(type + row);
	if(typeof(createUndo)==='undefined') 
		createUndo = true;	
	if(typeof(appendUndoState)==='undefined') 
		appendUndoStateo = false;		
		
	if (createUndo) {
		if (appendUndoState == false)
			createUndoState("STARTBUFFER", 0, true);		
		createUndoState("CU", row, true);	
	}		
	if (node == null) {
		updateStatusMessage("ERROR! Unable to set timecode: " + newValue + " for " + type + " point for row: " + row);
		console.log("ERROR! Unable to set subtitle value for row: " + row + " Here is a table dump");
		console.log(document.getElementById("subtitles"));
		return;
	}
	
	// The conversion from native to SRT gets screwy with fractional parts under 1/1000 of a second so it's best to round those off.
	newValue=Math.round(newValue * 1000) / 1000;
	node.setAttribute("data-nativetc", newValue);
	node.value=convertTC_NativetoSRT(newValue);
	
	if (createUndo) {
		createUndoState("CR", row, true);
		if (appendUndoState == false)		
			createUndoState("ENDBUFFER", 0, true);			
	}	
}

function getTimecode(type, row) {
	var TC=document.getElementById(type + row);
	
	if (TC == null)
		return "";
	else
		return TC.value.trim();
}
function getTimecodeNative(type, row) {
	var tc=document.getElementById(type + row);
	if (tc.hasAttribute("data-nativetc"))
		return Number( tc.getAttribute("data-nativetc") );
	else
		return Number.POSITIVE_INFINITY;
}

function setSubtitle(row, newValue, createUndo, appendUndoState) {
	var node=document.getElementById("SUB" + row);
	if(typeof(createUndo)==='undefined') 
		createUndo = true;
	if(typeof(appendUndoState)==='undefined') 
		appendUndoStateo = false;	

	if (createUndo) {
		if (appendUndoState == false)
			createUndoState("STARTBUFFER", 0, true);		
		createUndoState("CU", row, true);	
	}	
				
	if (node == null) {
		updateStatusMessage("ERROR! Unable to set subtitle value for row: " + row);
		console.log("ERROR! Unable to set subtitle value for row: " + row + " Here is a table dump");
		console.log(document.getElementById("subtitles"));
		return;
	}
	node.value=newValue;
	
	if (createUndo) {
		createUndoState("CR", row, true);
		if (appendUndoState == false)			
			createUndoState("ENDBUFFER", 0, true);		
	}		
}
function getSubtitle(row) {
	var sub=document.getElementById("SUB" + row);
	if (sub == null)
		return "";
	else
		return sub.value;
}
function updateSubtitle(event) {	
	var currentIn=document.getElementById("IN0");
	if (getTimecode("IN", 0) == "") {
		// So we don't store an undo state with the first letter we type we blank the subtitle before we create the state and then restore it
		var sub=getSubtitle(0);
		setSubtitle(0,"", false);
		setTimecode("IN", 0, document.getElementById("currentTimecode").innerHTML);
		setSubtitle(0,sub,false);
		return;
	} else // Don't pass the event because we don't want to create an undo state for every keypress
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
		
		// When subtitle 1's OUT point is the same as subtitle 2's IN point....
		// We want to actually display subtitle 2 and not subtitle 1. So below block of code ensures that happens
		if (index < CURRENT_ROW -1) {
			var nextIn=getTimecodeNative("IN", index+1);
			if (nextIn == time) {
				updateOverlayText(getSubtitle(index+1));
			}
		}	
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
	
function resetDisplayedSubtitle(event) {
	/* This needs to be reset anytime the user pauses or seeks to a different point in the video because the value will always be 
		greater than currentTime if they scrub backwards and thus it won't attempt to display previous subtitles.
	*/
	DISPLAYING_SUB_OUT_POINT=0;
	
	// Create an undo state for the change
	if(typeof(event)!=='undefined') {
		// Since this function is called for several reasons we need to avoid making undo states for everything except subtitle text changes
		if (event.target.id.substr(0,3) == "SUB") {
			var row=event.target.id.substr(3);
			createUndoState("C", row, false);
		}
	}
	
	forceDraw();
}
function forceDraw() {
	document.getElementById("video").setAttribute("forceRedraw", true);
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
	var node=	document.getElementById("statusMessage");
	node.innerText="";
}
function updateStatusMessage(message) {
	var node=	document.getElementById("statusMessage");
	node.innerText=message;
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

function addSub(insertAt, createUndo, appendUndoState) {
	if(typeof(createUndo)==='undefined') 
		createUndo = true;
		
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
		if (inPointNative == outPointNative)
			updateStatusMessage("You can't set an IN point and OUT point to the same value!");
		else
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
	input=document.createElement("input"); input.readOnly=true;
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
	input.setAttribute("min", "-3.0"); input.setAttribute("max", "3.0"); 
	input.setAttribute("step", "0.025"); input.className="shiftSubtitle"; input.value="0";
	input.addEventListener('input', shiftSub);	input.addEventListener('change', shiftSubFinalize);	
	td.appendChild(input);
	row.appendChild(td);
	
	td=document.createElement("td"); td.className="timecode";
	input=document.createElement("input"); input.readOnly=true;
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
	}
	CURRENT_ROW++;

	if (createUndo) {
		createUndoState("REBUILD", row, appendUndoState);
	}

	setTimecode("IN", 0, "", false);		
	setTimecode("OUT", 0, "", false);
	setSubtitle(0, "", false);
}
function deleteSubs(event) {
	var table=document.getElementById("subtitles");
	
	var numberDeleted=0;
	// Start at 1 because 0 is the user input row
	for (var i=1; i < CURRENT_ROW; i++) {
		if (document.getElementById("BOX"+i).checked) {
			// We only want to start the undoBuffer once...
			if (numberDeleted == 0)
				createUndoState("STARTBUFFER", 0, true);	
			createUndoState("R", i, true);
			table.deleteRow(document.getElementById("ROW"+i).rowIndex);
			numberDeleted++;
		}
	}

	// If we didn't actually delete anything here is no reason to update the table ID values
	if (numberDeleted == 0)
		return;
	
	createUndoState("ENDBUFFER", 0, true);	
	
	// Never actually 0 because we always count our data entry line
	CURRENT_ROW=table.rows.length + 1;
		
	// Since we deleted rows let's refresh the current subtitle being displayed in case it deleted
	resetDisplayedSubtitle();
	
	// Reset the status of the "Select All" checkbox because it shouldn't be checked if the user deleted the selection already.
	document.getElementById("selectAllCheckbox").checked="";
	
	forceDraw();
}
function splitSub(event) {
	var row=parseInt(event.target.id.slice(5));
	var table = document.getElementById("subtitles");
	
	// In order to reuse addSub() code we have to backup the values because it resets them after adding a sub.
	var tempIn=getTimecode("IN", 0);
	var tempOut=getTimecode("OUT", 0);
	var tempSub=getSubtitle(0);
	
	// Create a undo state for the original IN/OUT length
	createUndoState("STARTBUFFER", 0, true);		
	createUndoState("CU", row, true);
	
	var halfWayPoint=(getTimecodeNative("OUT", row) - getTimecodeNative("IN", row)) / 2;
	setTimecodeNative("IN", 0, getTimecodeNative("IN", row) + halfWayPoint, false);
	setTimecodeNative("OUT", 0, getTimecodeNative("OUT", row), false);
	setSubtitle(0, getSubtitle(row), false);

	// turn off the checkbox
	document.getElementById("BOX"+row).checked="";
		
	setTimecodeNative("OUT", row, getTimecodeNative("IN", row) + halfWayPoint, false, false);
	
	createUndoState("CR", row, true);	
	addSub(-1, true, true);	
	createUndoState("ENDBUFFER", 0, true);	

	
	// Restore backups
	setTimecode("IN", 0, tempIn, false);
	setTimecode("OUT", 0, tempOut, false);
	setSubtitle(0, tempSub, false);
	
	forceDraw();	
}

function shiftSub(event) {
	var row=parseInt(event.target.id.slice(5));

	var curIn=getTimecodeNative("IN",row);
	var curOut=getTimecodeNative("OUT",row);
	
	var oldIn=document.getElementById("IN" + row).getAttribute("beforeSlide");
	var oldOut=document.getElementById("OUT" + row).getAttribute("beforeSlide");

	if ( (isNaN(oldIn) || isNaN(oldOut) ) || (oldIn == null || oldOut == null) ) {
		resetStatus();
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
		
	if (videoTag.getAttribute("altKey") != "true")
		newIn=newIn + Number(event.target.value);
	if (videoTag.getAttribute("shiftKey") != "true")
		newOut=newOut + Number(event.target.value);
			
	// Don't let the user slide the subtitle past the start of the video		
	if (newIn < 0) {
		newOut=newOut - newIn; // Do this to keep the subtitle the same total duration
		newIn = 0;
	}
	
	// Don't let the user slide the subtitle past the end of the video
	if (newOut > videoTag.duration) {
		newIn=newOut - newIn; // Do this to keep the subtitle the same total duration
		newOut=videoTag.duration;
	}
	
	// Don't let the user slide a subtitle inside another subtitle
	var collideSub=detectTimecodeOverlap(row, newIn, newOut);
	if (collideSub != -1) {
		var duration=newOut-newIn;
		var collideIn=getTimecodeNative("IN", collideSub);
		var collideOut=getTimecodeNative("OUT", collideSub);
		if ( newIn > collideIn && newIn < collideOut ) {
			newIn=collideOut;
			newOut=newIn+duration;
		} else if ( newOut > collideIn && newOut < collideOut ) {
			newOut=collideIn;
			newIn=newOut-duration;
		}  
	}
		
	setTimecodeNative("IN", row, newIn, false, false);
	setTimecodeNative("OUT", row, newOut, false, false);	
	
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
		setTimecodeNative("IN", row, oldIn, false, false);
		setTimecodeNative("OUT", row, oldOut, false, false);
	} else if (curIn >= curOut) {
		updateStatusMessage("You can't have an IN point come after an OUT point");
		setTimecodeNative("IN", row, oldIn, false, false);
		setTimecodeNative("OUT", row, oldOut, false, false);	
	} else { 
		// Set an undoState for the original value
		createUndoState("STARTBUFFER", 0, true);			
		createUndoState("CR", row, true);
		setTimecodeNative("IN", row, oldIn, false, false);
		setTimecodeNative("OUT", row, oldOut, false, false);	
		createUndoState("CU", row, true);
		createUndoState("ENDBUFFER", 0, true);	
		
		// Set back to the new values
		setTimecodeNative("IN", row, curIn, false, false);
		setTimecodeNative("OUT", row, curOut, false, false);
				
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
	
	var shiftCount=0;
	// Step 1: Make sure the offsets don't push any values outside of the video range
	for (var i=1; i < CURRENT_ROW; i++) {
		if (document.getElementById("BOX"+i).checked) {
			shiftCount++;
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
	
	// Nothing to do so no reason to do the next loop
	if (shiftCount == 0)
		return;
		var tempOut=getTimecode("OUT", 0);
					
	createUndoState("STARTBUFFER", 0, true);	
		
	// Step 2: Make the changes to the timecode
	for (var i=1; i < CURRENT_ROW; i++) {
		if (document.getElementById("BOX"+i).checked) {
		
			createUndoState("CU", i, true);
			
			if (applyTo == "IN" || applyTo == "BOTH") {
				newValue=convertTC_NativetoSRT(getTimecodeNative("IN", i) + amount);
				setTimecode("IN", i, newValue, false, false);
			}
			if (applyTo == "OUT" || applyTo == "BOTH") {
				newValue=convertTC_NativetoSRT(getTimecodeNative("OUT", i) + amount);
				setTimecode("OUT", i, newValue, false, false);			
			}	
			
			createUndoState("CR", i, true);
		}
	}	
	
	createUndoState("ENDBUFFER", 0, true);	
	forceDraw();	
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
	var videoTag = document.getElementById("video");
	var time=videoTag.currentTime;
	
	// If the playhead is within 0.25 seconds of the IN point then it goes to the previous one instead
	//	This way you can rapidly rewind() backwards through every IN point
	var index=getClosestPointFromTime("IN", time, false, 0.25);
	if (index != -1) {
		videoTag.currentTime=getTimecodeNative("IN", index);
	}
	else
		videoTag.currentTime=0;	
}

function changePlayRate() {
	var videoTag = document.getElementById("video");
	var tag=document.getElementById("playRate")
	if (videoTag.readyState != 4) {
		updateStatusMessage("No video file loaded!");
		tag.value=0;
		return;
	}	
	var rate=tag.value;
	
	var newRate=1+(.1*rate);	
	// Adjust by 10% speed for each step
	videoTag.playbackRate=newRate;
	
	var asPercentage=Math.round(newRate*100);
	
	document.getElementById("currentSpeed").innerText="Current Speed:" + asPercentage + "%";
}
function slowDownVideo() {
	var node=document.getElementById("playRate");
	var min=Number(node.getAttribute("min"));
	
	var val=Number(node.value) - 1;
	if (val < min)
		val=min;
		
	node.value=val;
	
	var event=new Event("change");
	node.dispatchEvent(event);	
}
function speedUpVideo() {
	var node=document.getElementById("playRate");
	var max=Number(node.getAttribute("max"));
	
	var val=Number(node.value) +1;
	if (val > max)
		val=max;
		
	node.value=val;
	
	var event=new Event("change");
	node.dispatchEvent(event);	
}

function selectAll(event) {
	var checkBox=event.target;
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
	if(typeof(margin)==='undefined')  {
		margin=0.0;
		console.log("called");
	}	
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
	
	// Keep track of what modifier keys are up/down for the slider controls so they know to only modify IN or OUT points	
	var videoTag=document.getElementById("video");
	if (event.shiftKey == true || event.keyCode == 16)
		videoTag.setAttribute("shiftKey", "true");
	if (event.ctrlKey == true || event.keyCode == 17)
		videoTag.setAttribute("ctrlKey", "true");				
	if (event.altKey == true || event.keyCode == 18)
		videoTag.setAttribute("altKey", "true");	
	if (event.keyCode == 91) // Windows key or Mac Command key
		videoTag.setAttribute("metaKey", "true");

	switch(event.keyCode) {
		// Set IN/OUT Point
		case 73: // I
		case 219: // [
			if (videoTag.getAttribute("ctrlKey") == "true")
				BTNsetInPoint(event);
			break;
		case 79: // O
		case 221: // ]
			if (videoTag.getAttribute("ctrlKey") == "true")
				BTNsetOutPoint(event);
			break;
		
		// Clear IN/OUT Point	
		case 188: // , and < key	
			if (videoTag.getAttribute("ctrlKey") == "true")
				BTNclearInPoint(event); 
		break;
		case 190: // . and > key
			if (videoTag.getAttribute("ctrlKey") == "true")
				BTNclearOutPoint(event); 
		break;
		
		case 189: // - key
			if (videoTag.getAttribute("ctrlKey") != "true")
				break;
		case 109: // - key on numeric keypad		
				slowDownVideo();
		break;	
		case 187: // + key
			if (videoTag.getAttribute("ctrlKey") != "true")
				break;
		case 107: // + key on numeric keypad					
				speedUpVideo()		
		break;
						
		case 9: processTab(event);			break;
		case 13: processEnter(event); 		break;
		
		case 38: processUpArrow(event); 	break;
		case 40: processDownArrow(event); 	break;
		
		case 37: processLeftArrow(event);	break;
		case 39: processRightArrow(event);	break;
		
		case 33: // metaKey + PageUp
			if (videoTag.getAttribute("metaKey") != "true")
				break;
		case 113: // F2
			undo(); 
			break;
		case 34: // metaKey + PageDown
			if (videoTag.getAttribute("metaKey") != "true")
				break;
		case 114: // F3
			redo(); 
			break;
		
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
	}

	forceDraw();	
}
function processKeyboardInputKeyUp(event) {
	var videoTag=document.getElementById("video");
	switch(event.keyCode) {
		case 16: // Shift key up
			videoTag.setAttribute("shiftKey", "false");	break;
		case 17: // Control key up
			videoTag.setAttribute("ctrlKey", "false");	break;			
		case 18: // Alt Key Up
			videoTag.setAttribute("altKey", "false");	break;
		case 91:
			videoTag.setAttribute("metaKey", "false");	break;			
	}
}

function processTab(event) {
	// If we're not in IN0, OUT0, or SUB0 then TAB shouldn't do anything but the normal behavior
	if ( document.getElementById("rightSide").contains(document.activeElement) == true)
			return;
			
//	if (document.activeElement == document.getElementById("SUB0")) {
		event.preventDefault();	
		rewind();		
//	}
}
function processEnter(event) {
	var videoTag = document.getElementById("video");
	if (videoTag.readyState != 4) {
		updateStatusMessage("No video file loaded!");
		return;
	}
	
	// ALT + ENTER clears the OUT point
	if (videoTag.getAttribute("altKey") == "true") {
		event.preventDefault();
		setTimecode("OUT", 0, "");
		forceDraw();
		return;
	}	

	// CLTR + ENTER sets the OUT Point to current time
	if (videoTag.getAttribute("ctrlKey") == "true") {
		event.preventDefault();		
		setTimecode("OUT", 0, document.getElementById("currentTimecode").innerHTML);
		forceDraw();
		return;		
	}
	
	// If we're not in IN0, OUT0, or SUB0 then ENTER shouldn't do anything but the normal behavior
	if ( document.getElementById("currentInput").contains(document.activeElement) == false)
			return;
		
	// If the user does SHIFT + ENTER we just add a new line. 
	//	Otherwise add a new sub (or just set an OUT point if it's not set)
	if (event.shiftKey==false) {
		// Prevent ENTER from adding a newline in the currentSubtitle input
		if (document.activeElement == document.getElementById("SUB0")) 
			event.preventDefault();	
	
		if (getTimecode("IN", 0) == "") {
			updateStatusMessage("No In Point Set!");
			return;
		}
		
		if (getTimecode("OUT", 0) == "") {
			setTimecode("OUT", 0, document.getElementById("currentTimecode").innerHTML);
			document.getElementById("SUB0").focus();
			return;
		}
	
		BTNaddSubtitle();
	}
}
function processUpArrow(event) {
	var videoTag=document.getElementById("video");
	// If the user isn't holding down META or ALT when hitting an arrow then we are ignoring the input
	if (videoTag.getAttribute("altKey") != "true" && videoTag.getAttribute("metaKey") != "true")
		return
					
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
			
	createUndoState("STARTBUFFER", 0, true);			
				
	if (index != -1) { // Move OUT point from RIGHT of currentTime to currentTime
		createUndoState("CU", index, true);
		oldTime=getTimecode("OUT", index);
		setTimecode("OUT", index, newTime, false);
		createUndoState("CR", index, true);
				
		// If the previous IN point time was the same as the OUT point we just moved let's also adjust it
		if (videoTag.getAttribute("metaKey") == "true") {
			var oIndex=getIndexFromTimecode("IN", oldTime);
			if (oIndex != -1 ) {
				createUndoState("CU", oIndex, true);			
				setTimecode("IN", oIndex, newTime, false);
				createUndoState("CR", oIndex, true); 
			}
		}
	} else { // Move OUT point on the left of currentTime to currentTime
		index=getClosestPointFromTime("OUT", time, false);
		if (index != -1) {
			createUndoState("CU", index, true);		
			setTimecode("OUT", index, newTime, false);
			createUndoState("CR", index, true);
		}
	}
	
	createUndoState("ENDBUFFER", 0, true);
	resetDisplayedSubtitle();	
}
function processDownArrow(event) {
	var videoTag=document.getElementById("video");
	// If the user isn't holding down META or ALT when hitting an arrow then we are ignoring the input
	if (videoTag.getAttribute("altKey") != "true" && videoTag.getAttribute("metaKey") != "true")
		return
					
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

	createUndoState("STARTBUFFER", 0, true);	
				
	if (index != -1) { // Move IN point from LEFT of currentTime to currentTime
		createUndoState("CU", index, true);		
		oldTime=getTimecode("IN", index);
		setTimecode("IN", index, newTime, false);
		createUndoState("CR", index, true);	
		
		// If the previous OUT point time was the same as the IN point we just moved let's also adjust it
		if (videoTag.getAttribute("metaKey") == "true") {
			var oIndex=getIndexFromTimecode("OUT", oldTime);
			if (oIndex != -1 ) {
				createUndoState("CU", oIndex, true);		
				setTimecode("OUT", oIndex, newTime, false); 
				createUndoState("CR", oIndex, true);		
			}
		}
	} else { // Move IN point on the right of currentTime to currentTime
		index=getClosestPointFromTime("IN", time, true);
		if (index != -1) {
			createUndoState("CU", index, true);		
			setTimecode("IN", index, newTime, false);
			createUndoState("CR", index, true);		
		}
	}
	
	createUndoState("ENDBUFFER", 0, true);		
	resetDisplayedSubtitle();		
}
function processLeftArrow(event) {
	var videoTag=document.getElementById("video");
	// If the user isn't holding down META when hitting an arrow then we are ignoring the input
	if (videoTag.getAttribute("metaKey") != "true")
		return
					
	event.preventDefault();

	var videoTag = document.getElementById("video");
	if (videoTag.readyState != 4) {
		updateStatusMessage("No video file loaded!");
		return;
	}
			
	var videoTag = document.getElementById("video");
	var time=videoTag.currentTime;
	
	var index=getClosestPointFromTime("IN", time, false);
	if (index != -1) {
		videoTag.currentTime=getTimecodeNative("IN", index);
	}
	else
		videoTag.currentTime=0;

	resetDisplayedSubtitle();	
}
function processRightArrow(event) {
	var videoTag=document.getElementById("video");
	// If the user isn't holding down META when hitting an arrow then we are ignoring the input
	if (videoTag.getAttribute("metaKey") != "true")
		return
								
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


