
SCxml.invokeTypes={
	scxml: {
		name: 'http://www.w3.org/TR/scxml',
		instantiate: function(src, data, id, psc){
			var sc=new SCxml(src, null, null, true)
			sc.iid=id
			sc.name=id
			sc.parent=psc
			sc.sharedData=data
			// TODO: inject the data after datamodel init but before
			// running global scripts
			return sc
		}
	}
}

SCxml.prototype.invokeAll=function()
{
	var invs=this.dom.querySelectorAll("*[active] > invoke")
	for(var i=0; i<invs.length; i++){
		try{ this.invoke(invs[i]) } catch(err){throw err}
	}
	return this.toInvoke.length
}
SCxml.prototype.cancelInvoke=function(inv)
{
	if(!(inv in this.invoked))
		return false
	try{ this.invoked[inv].clean() } catch(err){throw err}
}

SCxml.prototype.invoke=function(inv)
{
	var id=getId(inv), loc
	if(id in this.invoked || id in this.toInvoke.items) return;
	
	if(loc=inv.getAttribute("idlocation"))
		this.expr(loc+'="'+id+'"')
	
	var type=inv.getAttribute("type")
		||this.expr(inv.getAttribute("typeexpr"), inv)
		||"SCXML"
	
	if(!(type in SCxml.invokeTypes)){
		type=type.replace(/\/$/, "")
		for(var st in SCxml.invokeTypes)
			if(SCxml.invokeTypes[st].name==type){ type=st; break }
	}
	if(!(type in SCxml.invokeTypes))
		this.error("execution",inv,
			new Error('unsupported invoke type "'+type+'"'))
	
	var src=inv.getAttribute("src")
		||this.expr(inv.getAttribute("srcexpr"), inv)
	var namelist=inv.getAttribute("namelist")
	var data={}
	if(namelist)
	{
		namelist=namelist.split(" ")
		for(var i=0, name; name=namelist[i]; i++)
			data[name]=this.expr(name)
	}
	this.readParams(inv, data)
	var c=this.dom.querySelector("[id='"+id+"'] > content")
	if(c){
		if(!c.firstElementChild) src=c.textContent
		else src=new XMLSerializer().serializeToString(c.firstElementChild)
	}
	
	this.toInvoke.add(id) // we won't continue interpretation of the parent
		// until the invoked session has become stable

	// now create the invoked session
	var invoked=SCxml.invokeTypes[type].instantiate(src, data, id, this)
	invoked.finalize=document.querySelector("#"+id+" > finalize")
	invoked.af=inv.hasAttribute('autoforward')
}
