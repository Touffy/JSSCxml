// UI listeners

UI.run.onclick=function(e)
{
	sc.pauseNext()
	sc.start()
	UI.pause.disabled=false
	this.disabled=true
}

UI.pause.onclick=function(e)
{
	sc.pauseNext()
	this.disabled=true
}

UI.parse.onclick=function(e)
{
	UI.pause.disabled=true
	UI.run.disabled=true
	document.forms[0][1].disabled=true
	document.forms[1][2].disabled=true
	if(sc){
		var targets=UI.view.querySelectorAll("transition[target]")
		for(var i=0; i<targets.length; i++) clearArrows(targets[i])
	}
	document.querySelector("#viewer td+td+td")
		.removeChild(document.querySelector("#viewer div.scxml"))
	var rm=document.head.getElementsByTagName("scxml")
	for(var i=0; i<rm.length; i++) document.head.removeChild(rm[i])
	clearQueues()
	if(sc) sc.clean()
	sc=new SCxml(document.getElementsByTagName("textarea")[0].value)
	sc.autoPauseBefore=SCxml.ALL_EVENTS
}

UI.load.onclick=function(e)
{
	UI.pause.disabled=true
	UI.run.disabled=true
	document.forms[0][1].disabled=true
	document.forms[1][2].disabled=true
	if(sc){
		var targets=UI.view.querySelectorAll("transition[target]")
		for(var i=0; i<targets.length; i++) clearArrows(targets[i])
	}
	document.querySelector("#viewer td+td+td")
		.removeChild(document.querySelector("#viewer div.scxml"))
	clearQueues()
	if(sc) sc.clean()
	var rm=document.head.getElementsByTagName("scxml")
	for(var i=0; i<rm.length; i++) document.head.removeChild(rm[i])
	sc=new SCxml(UI.src.value)
	sc.autoPauseBefore=SCxml.ALL_EVENTS
}

document.forms[0].onsubmit=function(e){
	if(!sc || sc.readyState<SCxml.READY || !this.ename.value) return false
	var event=new SCxml.InternalEvent(this.ename.value)
	sc.html.dispatchEvent(new CustomEvent("queue", {detail:event}))
	sc.internalQueue.push(event)
	if(sc.stable && !sc.paused) sc.mainEventLoop()
	return false
}
document.forms[1].onsubmit=function(e){
	if(!sc || sc.readyState<SCxml.READY || !this.ename.value) return false
	var data
	try{data=JSON.parse(this.data.value)} catch(err){}
	sc.fireEvent(this.ename.value, data)
	return false
}

// SCxml listeners

document.head.addEventListener("ready", function(e){
	if(e.target.interpreter!=sc) return;
	UI.run.disabled=false
	document.forms[0][1].disabled=false
	document.forms[1][2].disabled=false
	document.querySelector("#viewer td+td+td")
		.appendChild(convertSCXML(sc.dom))
	allArrows()
}, true)

document.head.addEventListener("exit", function(e){
	if(e.target.interpreter!=sc) return;
	e.detail.list.forEach(exit)
}, true)
document.head.addEventListener("enter", function(e){
	if(e.target.interpreter!=sc) return;
	setTimeout(applyEnter, 0, e.detail.list)
}, true)

document.head.addEventListener("finished", function(e){
	if(e.target.interpreter!=sc) return;
	UI.run.disabled=true
	UI.pause.disabled=true
}, true)

document.head.addEventListener("pause", function(e){
	if(e.target.interpreter!=sc) return;
	UI.pause.disabled=false
	UI.pause.value="resume"
	UI.pause.onclick=function(e){ sc.resume() }
	if(UI.speed.value<5000)
	setTimeout(UI.pause.onclick, +UI.speed.value)
}, true)

document.head.addEventListener("resume", function(e){
	if(e.target.interpreter!=sc) return;
	UI.pause.value="pause"
	UI.pause.onclick=function(e)
	{
		sc.pauseNext()
		this.disabled=true
	}
}, true)

document.head.addEventListener("queue", queue, true)
document.head.addEventListener("consume", consume, true)
