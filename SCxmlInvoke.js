
SCxml.invokeTypes={
	scxml: {
		name: 'http://www.w3.org/TR/scxml',
		instantiate: function(src, data, id, psc){
			var sc=new SCxml(src, null, null, true)
			sc.iid=id
			sc.name=id
			sc.parent=psc
			sc.sharedData=data
			return sc
		}
	}
}

SCxml.prototype.invokeAll=function()
{
	var invs=this.dom.querySelectorAll("*[active] > invoke")
	for(var i=0; i<invs.length; i++){
		try{ this.invoke(invs[i]) } catch(err){}
	}
	return this.toInvoke.length
}
SCxml.prototype.cancelInvoke=function(inv)
{
	if(!(inv in this.invoked))
		return false
	try{ this.invoked[inv].clean() } catch(err){}
}

SCxml.prototype.invoke=function(inv)
{
	var id=getId(inv), loc
	if(id in this.invoked || id in this.toInvoke.items) return;
	
	if(loc=inv.getAttribute("idlocation"))
		this.expr(loc+'="'+id+'"')
	
	var type=inv.getAttribute("type")
		||this.expr(inv.getAttribute("typeexpr"), inv)
		||"scxml"
	
	if(!(type in SCxml.invokeTypes)){
		type=type.replace(/\/$/, "")
		for(var st in SCxml.invokeTypes)
			if(SCxml.invokeTypes[st].name==type){ type=st; break }
	}
	if(!(type in SCxml.invokeTypes))
		this.error("execution",inv,
			new Error('unsupported invoke type "'+type+'"'))
	
	var namelist=inv.getAttribute("namelist")
	var data={}
	if(namelist)
	{
		namelist=namelist.split(" ")
		for(var i=0, name; name=namelist[i]; i++)
			data[name]=this.expr(name)
	}
	
	if('open' in SCxml.invokeTypes[type]){
	// we're dealing with a connection-like invoke
		var src=inv.getAttribute("target")
			||this.expr(inv.getAttribute("targetexpr"), inv)
		if(!src) this.error("execution",inv, new Error('target required'))
		
		data=this.readParams(inv, data, true)
	}
	else{
		var src=inv.getAttribute("src")
			||this.expr(inv.getAttribute("srcexpr"), inv)
		var c=this.dom.querySelector("[id='"+id+"'] > content")
		if(c){
			if(c.hasAttribute("expr"))
				src=this.expr(c.getAttribute("expr"), c)
			else if(!c.firstElementChild) src=c.textContent
			else src=new XMLSerializer().serializeToString(c.firstElementChild)
		}
		data=this.readParams(inv, data)
		this.toInvoke.add(id) // we won't continue interpretation of the parent
			// until the invoked session has become stable
	}
	
	// now create the invoked session
	var invoked=SCxml.invokeTypes[type][('open' in SCxml.invokeTypes[type])?
		"open":"instantiate"](src, data, id, this)
	invoked.af=inv.hasAttribute('autoforward')
}

SCxml.prototype.emptyFinalize=function(event)
{
	var inv=this.invoked[event.invokeid]
	if(!inv.sharedData || !event.data) return;
	for(var i in inv.sharedData) if(i in event.data)
		this.assign(i, event.data[i])
}
