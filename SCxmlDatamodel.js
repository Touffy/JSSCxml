
SCxml.prototype.initIframe=function (data)
{
	if(this.datamodel) return;
	
	var i=document.createElement("iframe")
	i.className="scxml_script_frame"
	i.style.display="none"
	document.body.appendChild(i)
	this.datamodel=i.contentWindow

	with(this.datamodel.document)
	{
		open()
		write('<script>\n'
			+ 'function expr(s,el)\n{\n'
			+ '	try{ with(_jsscxml_predefined_){ return eval(s) } }\n'
			+ '	catch(e){ _sc.error("execution",el,e) }\n'
			+ '}'

			+'\n</script>\n')
	}
	
	this.datamodel._sc=this

	// shadow all predefined variables
	this.datamodel._jsscxml_predefined_={}
	for(var i in this.datamodel) if(this.datamodel.hasOwnProperty(i))
		this.datamodel._jsscxml_predefined_[i]=undefined
	 
	this.datamodel._sessionid=this.sid
	this.datamodel._event=undefined
	this.datamodel._name=""
	this.datamodel._ioprocessors=SCxml.EventProcessors
	this.datamodel._x={}
	
	if(data) for(i in data) if(data.hasOwnProperty(i))
	{
		if(this.datamodel.hasOwnProperty(i))
			this.datamodel._jsscxml_predefined_[i]=data[i]
		else this.datamodel[i]=data[i]
	}
	
	this.datamodel.document.write('<script>\n'
		+'function In(state){ return state in _sc.configuration }\n</script>')
}

SCxml.prototype.wrapScript=function (script, element)
{
	this.datamodel.document.write('<script>\n'
		+ 'try{ with(_jsscxml_predefined_){\n' + script
		+ '\n}} catch(err){_sc.error("execution", element, err)}\n</script>')
}
