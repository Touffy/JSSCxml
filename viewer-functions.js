SCxml.prototype.xhrResponse=function(xhr){
	document.getElementsByTagName("textarea")[0].value=xhr.req.responseText
	this.interpret(xhr.req.responseXML)
}

function drawTransition(t)
{
	var targets=t.getAttribute("target")
	if(targets) targets=targets.split(" ").map(getBySCId)
	else return;
	
	clearArrows(t)
	
	var oxl=+t.offsetLeft+1
	var oxr=+t.offsetLeft+t.offsetWidth-1
	var oy=+t.offsetTop+t.offsetHeight-2
	
	for(var i=0; i<targets.length; i++) if(targets[i])
	{
		var dxl=targets[i].offsetLeft-5
		var dxr=targets[i].offsetLeft+targets[i].offsetWidth+5
		var dy=targets[i].offsetTop+13
		var d,x
		
		if(dxl > oxr){
			x=(dxl-oxr)/2
			d='M '+oxr+' '+oy+' C '+(oxr+x)+' '+oy
			+' '+(dxl-x)+' '+dy+' '+dxl+' '+dy
		}
		else if(dxr < oxl){
			x=(oxl-drx)/2
			d='M '+oxl+' '+oy+' C '+(oxl-x)+' '+oy
			+' '+(dxr+x)+' '+dy+' '+dxr+' '+dy
		}
		else{
			x=Math.abs(orx-dxr)
			d='M '+oxr+' '+oy+' C '+(oxr+x)+' '+oy
			+' '+(dxr+x)+' '+dy+' '+dxr+' '+dy
		}
		var path = document.createElementNS("http://www.w3.org/2000/svg","path")
		path.setAttributeNS(null,"d",d)
		path.setAttributeNS(null,"marker-end","url(#arrow)")
		t.arrows.push(UI.arrows.appendChild(path))
	}
	opacityArrows(t)
}

function allArrows()
{
	var targets=UI.view.querySelectorAll("transition[target]")
	for(var i=0; i<targets.length; i++)
		drawTransition(targets[i])
}

function clearArrows(t)
{
	if(t.arrows)
		for(var i=0; i<t.arrows.length; i++)
			UI.arrows.removeChild(t.arrows[i])
	t.arrows=[]
}
function opacityArrows(t)
{
	var op=t.parentNode.classList.contains("active")?1:0.5

	if(t.arrows)
		for(var i=0; i<t.arrows.length; i++)
			t.arrows[i].style.opacity=op
}

function convertNode(e)
{
	if(!(e.tagName in SCxml.STATE_ELEMENTS))
		return null
	var h=document.createElement("state")
	h.className=e.tagName
	var id=e.getAttribute("id")
	h.appendChild(document.createElement("h4")).textContent=id
	h.setAttribute("scid", id)
	for(var cn, c=e.firstElementChild; c; c=c.nextElementSibling)
		if(cn=convertNode(c)) h.appendChild(cn)
	for(var cn, c=e.firstElementChild; c; c=c.nextElementSibling)
		if(cn=convertInvoke(c)) h.appendChild(cn)
	for(var cn, c=e.firstElementChild; c; c=c.nextElementSibling)
		if(cn=convertTransition(c)) h.appendChild(cn)
	return h
}

function convertTransition(e)
{
	if(e.tagName!="transition")
		return null
	var h=document.createElement("transition")
	var ev=e.getAttribute("event")
	h.appendChild(document.createElement("h4")).textContent=ev||"event"
	if(e.hasAttribute("event")) h.setAttribute("event", ev)
	if(e.hasAttribute("cond"))
	{
		var cond=e.getAttribute("cond")
		h.setAttribute("cond", cond)
		h.appendChild(document.createElement("code")).textContent=cond
	}
	if(e.hasAttribute("target"))
		h.setAttribute("target", e.getAttribute("target"))
	
	return h
}

function convertInvoke(e)
{
	if(e.tagName!="invoke")
		return null
	var h=document.createElement("invoke")
	var id=e.getAttribute("id")
	h.appendChild(document.createElement("h4")).textContent=id
	h.setAttribute("scid", id)
	return h
}

function convertSCXML(dom){
	var d=document.createElement("div")
	d.className="scxml"
	for(var cn, c=dom.documentElement.firstElementChild; c; c=c.nextElementSibling)
		if(cn=convertNode(c)) d.appendChild(cn)
	return d
}

function getBySCId(id)
{
	return UI.view.querySelector("[scid="+id+"]")
}

function enter(id)
{
	var s=getBySCId(id)
	s.classList.remove("exited")
	s.classList.add("active")
	for(var c=s.firstElementChild; c; c=c.nextElementSibling)
		if(c.tagName=="transition" || c.tagName=="TRANSITION") opacityArrows(c)
}
function applyEnter(l){ l.forEach(enter) }
function exit(id)
{
	var s=getBySCId(id)
	s.classList.remove("active")
	s.classList.add("exited")
	for(var c=s.firstElementChild; c; c=c.nextElementSibling)
		if(c.tagName=="transition" || c.tagName=="TRANSITION") opacityArrows(c)
}

function clearQueues()
{
	var c
	while(c=UI.intQ.firstChild) UI.intQ.removeChild(c)
	while(c=UI.extQ.firstChild) UI.extQ.removeChild(c)
}

function queue(e)
{
	if(e.target.interpreter!=sc) return;
	var h=document.createElement("li")
	h.textContent=e.detail.name
	if(/^error/.test(e.detail.name)) h.classList.add("error")
	;(e.detail.type=="external"?UI.extQ:UI.intQ).appendChild(h)
}
function consume(e)
{
	if(e.target.interpreter!=sc) return;
	for(var c=(e.detail=="external"?UI.extQ:UI.intQ).firstElementChild;
		c.classList.contains("burn"); c=c.nextElementSibling);
	c.classList.add("burn")
	c.addEventListener("webkitAnimationEnd", cleanAshes, true)
}
function cleanAshes(e){
	this.parentNode.removeChild(this)
}
