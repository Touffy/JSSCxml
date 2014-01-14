SCxml.prototype.pauseNext=function(macrostep)
{
	this.nextPauseBefore=2-!!macrostep
	if(this.stable) this.pause()
}
	
SCxml.prototype.mainEventLoop=function()
{
	while(this.running && !this.stable){
		if(this.nextPauseBefore==1) return this.pause()
		if(this.autoPauseBefore==1) this.nextPauseBefore=1
		this.macrostep()
		if(this.paused) return;
		if(!this.running) return this.terminate()
		
		if(this.invokeAll()) return; // because invocation is asynchronous
		
		this.stable=true
		this.extEventLoop()
		if(!this.running) return this.terminate()
	}
	this.invokedReady()
}

SCxml.prototype.macrostep=function()
{
	while(this.running){
		if(this.nextPauseBefore==2) return this.pause()
		if(this.autoPauseBefore==2) this.nextPauseBefore=2
		// first try eventless transition
		var trans=this.selectTransitions(null)
		if(!trans.length){
			// if none is enabled, consume internal events
			var event
			while(event=this.internalQueue.shift())
			{
				this.lastEvent=event
				this.html.dispatchEvent(new CustomEvent("consume", {detail:"internal"}))
				trans=this.selectTransitions(event)
				if(trans.length) break
			}
		}
		if(trans.length) this.preTransitions(trans)
		else break
	}
}

// NEVER call this directly, use pauseNext() instead
SCxml.prototype.pause=function()
{
	if(this.paused || !this.running) return;
	this.paused=true
	for(var i=0, sends=this.dom.querySelectorAll("send"), send;
		send=sends[i]; i++) if(send.sent && send.sent.length)
			for(var j=0, timer; timer=send.sent[j]; j++) timer.stop()
	this.html.dispatchEvent(new Event("pause"))
}

// resume a running SC
SCxml.prototype.resume=function()
{
	if(!this.running || !this.paused) return;
	this.nextPauseBefore=0
	this.paused=false
	for(var timer; timer=this.timeouts.pop(); timer.start());
	this.html.dispatchEvent(new Event("resume"))
	this.mainEventLoop()
}

SCxml.debug=function(e)
{
	new SCxml.View(this.interpreter)
}

// parses <scxml> tags with the debug attribute
SCxml.parseSCXMLTags=function()
{
	var tags=document.getElementsByTagName("scxml")
	for(var i=0; i<tags.length; i++){
		tags[i].interpreter=
			new SCxml(tags[i].getAttribute("src"), tags[i], null,
				!tags[i].hasAttribute("debug"))
		if(tags[i].hasAttribute("debug")){
			new SCxml.View(tags[i].interpreter)
			tags[i].interpreter.autoPauseBefore=2
		}
	}
}

SCxml.View=function SCxmlView(sc, into)
{
	this.sc=sc
	this.ui=SCxml.View.createUI()
	if(!into && sc.html.parentNode==document.head)
		into=document.body
	if(into){
		into=into.appendChild(document.createElement("scxml"))
		into.setAttribute("debug", true)
		into.interpreter=sc
	}
	else into=sc.html
	into.appendChild(this.ui)
	sc.view=this
	this.ui.sc.view=this
	sc.html.addEventListener("validated", SCxml.View.init, true)
	this.obs={}
	for(var i in SCxml.View.obs){
		this.obs[i]=new MutationObserver(SCxml.View.obs[i]),
		this.obs[i].sc=sc
	}
}

SCxml.View.init=function(e){
	this.removeEventListener("validated", SCxml.View.init, true)
	
	var sc=e.target.interpreter
	sc.view.convertSCXML()
	sc.view.ui.arrows.style.width=+sc.view.ui.sc.parentNode.offsetWidth+20+"px"
	sc.view.allArrows()
	
	this.addEventListener("ready", SCxml.View.onready, true)
//	this.addEventListener("step", SCxml.View.onstep, true)
	this.addEventListener("exit", SCxml.View.onexit, true)
	this.addEventListener("enter", SCxml.View.onenter, true)
	this.addEventListener("finished", SCxml.View.onfinished, true)
	this.addEventListener("pause", SCxml.View.onpause, true)
	this.addEventListener("resume", SCxml.View.onresume, true)
	this.addEventListener("queue", SCxml.View.onqueue, true)
	this.addEventListener("consume", SCxml.View.onconsume, true)
}
SCxml.View.onready=function(e){
	if(e.target.interpreter.parent) return;
	this.interpreter.view.ui.run.disabled=false
	this.interpreter.view.ui.run.value="run"
	this.interpreter.view.ui.run.onclick=SCxml.View.clickrun
	setTimeout(SCxml.View.redraw, 0, this.interpreter.view)
}
SCxml.View.redraw=function(v){
	v.ui.arrows.style.width=+v.ui.sc.parentNode.offsetWidth+20+"px"
	v.allArrows()
}
SCxml.View.onexit=function(e){
	if(e.target.interpreter.parent) return;
	e.detail.list.forEach(this.interpreter.view.exit,this.interpreter.view)
}
SCxml.View.onstep=function(e){
	if(e.target.interpreter.parent) return;
	this.interpreter.transitionsToTake.forEach(
		this.interpreter.view.enable, this.interpreter.view)
}
SCxml.View.onenter=function(e){
	if(e.target.interpreter.parent) return;
	setTimeout(SCxml.View.applyEnter, 0, e.detail.list, this.interpreter.view)
}
SCxml.View.applyEnter=function(l, view){
	l.forEach(view.enter, view)
}
SCxml.View.onfinished=function(e){
	if(e.target.interpreter.parent) return;
	this.interpreter.view.ui.run.disabled=false
	this.interpreter.view.ui.run.value="restart"
	this.interpreter.view.ui.run.onclick=SCxml.View.clickrun2
	this.interpreter.view.ui.pause.disabled=true
}
SCxml.View.onpause=function(e){
	if(e.target.interpreter.parent) return;
	this.interpreter.view.ui.pause.disabled=false
	this.interpreter.view.ui.pause.value="resume"
	this.interpreter.view.ui.pause.onclick=SCxml.View.clickresume
	if(this.interpreter.view.ui.speed.value<5000)
		setTimeout(SCxml.View.autoresume,
			+this.interpreter.view.ui.speed.value,
			this.interpreter.view)
}
SCxml.View.onresume=function(e){
	if(e.target.interpreter.parent) return;
	this.interpreter.view.ui.pause.value="pause"
	this.interpreter.view.ui.pause.disabled=false
	this.interpreter.view.ui.pause.onclick=SCxml.View.clickpause
}

SCxml.View.clickrun=function(e)
{
	var ui=this.parentNode.parentNode
	var sc=ui.parentNode.interpreter
	sc.pauseNext()
	sc.start()
	ui.pause.disabled=false
	this.disabled=true
}
SCxml.View.clickrun2=function(e)
{
	var sc=this.parentNode.parentNode.parentNode.interpreter
	this.disabled=true
	sc.view.clearQueues()
	sc.view.clearActive()
	sc.restart()
}
SCxml.View.clickpause=function(e)
{
	this.parentNode.parentNode.parentNode.interpreter.pauseNext()
	this.disabled=true
}
SCxml.View.autoresume=function(view)
{
	view.sc.resume()
}
SCxml.View.clickresume=function(e)
{
	this.parentNode.parentNode.parentNode.interpreter.resume()
}
SCxml.View.cleanAshes=function(e){
	this.parentNode.removeChild(this)
}
SCxml.View.onqueue=function(e)
{
	if(e.target.interpreter.parent) return;
	var h=document.createElement("li")
	h.textContent=e.detail.name
	if(/^error/.test(e.detail.name)) h.classList.add("error")
	this.interpreter.view.ui[(e.detail.type=="external")?'extQ':'intQ']
		.appendChild(h)
}
SCxml.View.onconsume=function(e)
{
	if(e.target.interpreter.parent) return;
	var c=this.interpreter.view.ui[(e.detail=="external")?'extQ':'intQ']
	for(c=c.firstElementChild;
		c.classList.contains("burn");
		c=c.nextElementSibling);
	c.classList.add("burn")
	c.addEventListener("webkitAnimationEnd", SCxml.View.cleanAshes, true)
}

SCxml.View.hoverArrow=function(e)
{
	if(!(e.target instanceof SVGPathElement)) return;
	if(e.type=="mouseover") e.target.from.classList.add("on")
	else e.target.from.classList.remove("on")
}
SCxml.View.hoverTrans=function(e)
{
	for(var a in this.arrows) if(this.arrows[a] instanceof SVGPathElement)
		this.arrows[a].className.baseVal=(e.type=="mouseover"?"on":"")
			+(this.classList.contains("enabled")?" enabled":"")
}
SCxml.View.toggle=function(e){
	if(e.target.localName=="h4" && e.button==0){
		e.preventDefault()
		return
	}
	if(e.target.localName!="summary") return;
	setTimeout(SCxml.View.redraw, 0, this.view)
}
SCxml.View.blockEnter=function(e){
	if(e.target.contentEditable!=="true") return;
	if(e.keyCode==13) e.target.blur()
	if((e.keyCode==32 && e.target.parentNode.localName=="summary")
		|| e.keyCode==13) e.preventDefault()
	else setTimeout(SCxml.View.redraw, 0, this.view)
}

SCxml.View.createUI=function()
{
	var UI=document.createElement("table")
	UI.className="SCxmlDebug"
	var h=UI.createCaption()
	with(UI.run=h.appendChild(document.createElement("input"))){
		type="button"
		value="Run"
		disabled=true
		onclick=SCxml.View.clickrun
	}
	with(UI.pause=h.appendChild(document.createElement("input"))){
		type="button"
		value="Pause"
		disabled=true
		onclick=SCxml.View.clickpause
	}
	var l=h.appendChild(document.createElement("label"))
	l.textContent="autoresume: "
	with(UI.speed=l.appendChild(document.createElement("input"))){
		type="range"
		setAttribute("value","1000")
		setAttribute("min","300")
		setAttribute("max","5000")
	}

	var t=UI.createTBody().insertRow()
	with(t.insertCell()){
		var svgns="http://www.w3.org/2000/svg"
		with(UI.arrows=appendChild(document.createElementNS(svgns, "svg"))){
			setAttributeNS(null, "version", "1.1")
			with(appendChild(document.createElementNS(svgns, "defs"))
				.appendChild(document.createElementNS(svgns, "marker"))){
				setAttributeNS(null, "id", "arrow")
				setAttributeNS(null, "viewBox", "0 0 10 10")
				setAttributeNS(null, "refX", "1")
				setAttributeNS(null, "refY", "5")
				setAttributeNS(null, "markerUnits", "strokeWidth")
				setAttributeNS(null, "orient", "auto")
				setAttributeNS(null, "markerWidth", "6")
				setAttributeNS(null, "markerHeight", "4.5")
				appendChild(document.createElementNS(svgns, "polyline"))
					.setAttributeNS(null, "points", "0,0 10,5 0,10 1,5")
			}
			firstChild.appendChild(firstChild.firstChild.cloneNode(true))
				.setAttributeNS(null, "id", "arrowOn")
/*			firstChild.appendChild(firstChild.firstChild.cloneNode(true))
				.setAttributeNS(null, "id", "arrowEnabled")
			firstChild.appendChild(firstChild.firstChild.cloneNode(true))
				.setAttributeNS(null, "id", "arrowOnEnabled")
*/		}
		;(UI.sc=appendChild(document.createElement("div"))).className="sc"
	}

	with(t.insertCell()){
		className="queue"
		appendChild(document.createElement("h2")).textContent="external queue"
		UI.extQ=appendChild(document.createElement("ol"))
	}
	with(t.insertCell()){
		className="queue"
		appendChild(document.createElement("h2")).textContent="internal queue"
		UI.intQ=appendChild(document.createElement("ol"))
	}
	
	UI.arrows.addEventListener("mouseover", SCxml.View.hoverArrow, true)
	UI.arrows.addEventListener("mouseout", SCxml.View.hoverArrow, true)
	UI.sc.addEventListener("click", SCxml.View.toggle, true)
	UI.sc.addEventListener("keydown", SCxml.View.blockEnter, true)
	// add scoped style?

	return UI
}

SCxml.View.textObsConfig={characterData:true, subtree: true, childList: true}

SCxml.View.valid={
	event:/^(?:\w+|\*)(?:\.(?:\w+|\*))*(?:\s+(?:\w+|\*)(?:\.(?:\w+|\*))*)*$/,
	id:/^\w+(?:\.\w+)*$/,
	target:/^\w+(?:\.\w+)*(?: \w+(?:\.\w+)*)*$/
}

SCxml.View.makeObs=function(prop, re, required){
	return function(mutations, obs)
	{
		var t=mutations[0].target
		if(mutations[0].type=="characterData") t=t.parentNode
		var str=t.textContent,
			owner=t.parentNode.parentNode,
			cl=t.classList

		if(!str){
			cl.add("empty")
			if(required) return cl.add("invalid")
			obs.sc.JSSCID[owner._JSSCID].removeAttribute(prop)
		}
		else{
			cl.remove("empty")
			if(re && !re.test(str))
				cl.add("invalid")
			else{
				cl.remove("invalid")
				obs.sc.JSSCID[owner._JSSCID].setAttribute(prop, str)
			}
		}
	}
}
SCxml.View.obs={
	stateId:SCxml.View.makeObs("id",SCxml.View.valid.id,true),
	transitionEvent:SCxml.View.makeObs("event",SCxml.View.valid.event),
	transitionCond:SCxml.View.makeObs("cond"),
	transitionTarget:SCxml.View.makeObs("target",SCxml.View.valid.target),
	transitionTargetexpr:SCxml.View.makeObs("targetexpr")
}

SCxml.View.prototype={

constructor:SCxml.View,

// draw the arrows to the transition's target states
drawTransition:function(t)
{
	var scT=this.sc.JSSCID[t._JSSCID]
	if(!scT.targets || !scT.targets.length) return
	
	var targets=this.sc.resolve(scT.targets)
	
	this.clearArrows(t)
	for(var o=t; !o.offsetHeight; o=o.parentNode);
	var oxl=+o.offsetLeft
	var oxr=+o.offsetLeft+o.offsetWidth-1
	var oy=+o.offsetTop+o.offsetHeight-2
	
	for(var i=0; i<targets.length; i++) if(targets[i])
	{
		var target=targets[i].ui
		if(!t.offsetHeight && !target.offsetHeight) continue
		for(; !target.offsetHeight; target=target.parentNode);
		var dxl=target.offsetLeft-3
		var dxr=target.offsetLeft+target.offsetWidth+2
		var dy=target.offsetTop+13
		var d,x
		
		if(dxl > oxr){
			x=Math.sqrt(dxl-oxr)*3+3
			d='M '+oxr+' '+oy+' C '+(oxr+x+4)+' '+oy
			+' '+(dxl-x)+' '+dy+' '+dxl+' '+dy
		}
		else if(dxr < oxl){
			x=Math.sqrt(oxl-dxr)*3+3
			d='M '+oxl+' '+oy+' C '+(oxl-x-4)+' '+oy
			+' '+(dxr+x)+' '+dy+' '+dxr+' '+dy
		}
		else{
			x=Math.sqrt(Math.abs(oxr-dxr))*4+5
			d='M '+oxr+' '+oy+' C '+(oxr+x+5)+' '+oy
			+' '+(dxr+x)+' '+dy+' '+dxr+' '+dy
		}
		var path = document.createElementNS("http://www.w3.org/2000/svg","path")
		path.setAttributeNS(null,"d",d)
		path.from=t
		t.arrows.push(this.ui.arrows.appendChild(path))
	}
	this.opacityArrows(t)
},

allArrows:function()
{
	var targets=this.ui.querySelectorAll(".transition")
	for(var i=0; i<targets.length; i++)
		this.drawTransition(targets[i])
},

clearArrows:function(t)
{
	if(t.arrows)
		for(var i=0; i<t.arrows.length; i++){
			this.ui.arrows.removeChild(t.arrows[i])
			delete t.arrows[i].from
		}
	t.arrows=[]
},
opacityArrows:function(t)
{
	var op=t.parentNode.classList.contains("active")?1:0.5

	if(t.arrows)
		for(var i=0; i<t.arrows.length; i++)
			t.arrows[i].style.opacity=op
},
enable:function(t)
{
	t.ui.classList.add("enabled")
	if(t.ui.arrows)
		for(var i=0; i<t.ui.arrows.length; i++)
			t.ui.arrows[i].className="enabled"
},

convertNode:function(e)
{
	if(!(e.tagName in SCxml.STATE_ELEMENTS))
		return null
	var h=document.createElement("details")
	h._JSSCID=e._JSSCID
	e.ui=h
	h.className=e.tagName
	h.open=true
	var id=e.getAttribute("id")
	h.appendChild(document.createElement("summary"))
		.appendChild(document.createElement("h4")).contentEditable=true
	this.obs.stateId.observe(
		h.lastChild.firstChild.appendChild(document.createTextNode(id)),
		SCxml.View.textObsConfig)
	h.setAttribute("scid", id)
	for(var cn, c=e.firstElementChild; c; c=c.nextElementSibling)
		if(cn=this.convertNode(c)) h.appendChild(cn)
	for(var cn, c=e.firstElementChild; c; c=c.nextElementSibling)
		if(cn=this.convertInvoke(c)) h.appendChild(cn)
	for(var cn, c=e.firstElementChild; c; c=c.nextElementSibling)
		if(cn=this.convertTransition(c)) h.appendChild(cn)
	return h
},
convertTransition:function(e)
{
	if(e.tagName!="transition")
		return null
	var h=document.createElement("details")
	h._JSSCID=e._JSSCID
	e.ui=h
	h.className="transition"
	var ev=e.getAttribute("event")||"",
		cond=e.getAttribute("cond")||"",
		t=e.getAttribute("target")||"",
		texpr=e.getAttribute("targetexpr")||""
	
	if(e.hasAttribute("event")) h.setAttribute("event", ev)
	with(h.appendChild(document.createElement("summary"))){
		appendChild(document.createElement("h4")).contentEditable=true
		if(!ev) firstChild.classList.add("empty")
		title="show/hide condition and target fields"
		firstChild.textContent=ev
		this.obs.transitionEvent.observe(firstChild, SCxml.View.textObsConfig)
	}
	h.appendChild(document.createElement("code")).contentEditable=true
	if(!cond) h.lastChild.classList.add("empty")
	this.obs.transitionCond.observe(
		h.lastChild.appendChild(document.createTextNode(cond)),
		SCxml.View.textObsConfig)
	h.appendChild(document.createElement("span")).contentEditable=true
	if(!t) h.lastChild.classList.add("empty")
	this.obs.transitionTarget.observe(
		h.lastChild.appendChild(document.createTextNode(t)),
		SCxml.View.textObsConfig)
	h.appendChild(document.createElement("code")).contentEditable=true
	if(!texpr) h.lastChild.classList.add("empty")
	h.lastChild.style.display="none"
	this.obs.transitionTargetexpr.observe(
		h.lastChild.appendChild(document.createTextNode(texpr)),
		SCxml.View.textObsConfig)
	with(h.appendChild(document.createElement("label"))){
		appendChild(document.createElement("input")).type="checkbox"
		firstChild.checked=e.hasAttribute("targetexpr")
		appendChild(document.createTextNode("expr"))
	}
	
	h.addEventListener("mouseover", SCxml.View.hoverTrans, true)
	h.addEventListener("mouseout", SCxml.View.hoverTrans, true)

	return h
},
convertInvoke:function(e)
{
	if(e.tagName!="invoke")
		return null
	var h=document.createElement("invoke")
	h._JSSCID=e._JSSCID
	e.ui=h
	var id=e.getAttribute("id")
	h.appendChild(document.createElement("h4")).textContent=id
	h.setAttribute("scid", id)
	return h
},
convertSCXML:function(){
	for(var cn, c=this.sc.dom.documentElement.firstElementChild; c;
		c=c.nextElementSibling)
		if(cn=this.convertNode(c)) this.ui.sc.appendChild(cn)
},

getBySCId:function(id)
{
	return this.ui.querySelector("[scid="+id+"]")
},

enter:function(id)
{
	var s=this.getBySCId(id)
	s.classList.remove("exited")
	s.classList.add("active")
	for(var c=s.firstElementChild; c; c=c.nextElementSibling)
		if(c.classList.contains("transition"))
			this.opacityArrows(c)
},
exit:function(id)
{
	var s=this.getBySCId(id)
	s.classList.remove("active")
	s.classList.add("exited")
	for(var c=s.firstElementChild; c; c=c.nextElementSibling)
		if(c.classList.contains("transition"))
			this.opacityArrows(c)
},

clearQueues:function()
{
	var c
	while(c=this.ui.intQ.firstChild) this.ui.intQ.removeChild(c)
	while(c=this.ui.extQ.firstChild) this.ui.extQ.removeChild(c)
},

clearActive:function()
{
	for(var i=0, c, l=this.ui.querySelectorAll("*.active"); c=l[i]; i++)
		c.classList.remove("active")
}

}