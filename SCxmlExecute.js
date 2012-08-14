// just declares datamodel variables as undefined
SCxml.prototype.declare=function(element)
{
	var c=element.firstElementChild
	if(element.tagName=="data")
	{
		var id=element.getAttribute("id")
		this.datamodel[id]=undefined
	}
	else while(c)
	{
		this.declare(c)
		c=c.nextElementSibling
	}
}

SCxml.prototype.readParams=function(element, data)
{
	var c=element.firstElementChild
	while(c) if(c.tagName=="param")
	{
		var name=c.getAttribute("name")
		var value=c.getAttribute("expr") || c.getAttribute("loc")
		try{
			if(data.hasOwnProperty(name))
			{
				if(data[name] instanceof Array)
					data[name].push(this.expr(value, c))
				else data[name] = [data[name], this.expr(value, c)]
			}
			else data[name] = this.expr(value, c)
		}catch(err){ throw err}

		c=c.nextElementSibling
	}
}



// handles executable content
SCxml.prototype.execute=function(element)
{
	var value=element.getAttribute("expr")
	var c=element.firstElementChild
	var loc, event
	switch(element.tagName)
	{
	case "raise":
		event=element.getAttribute("event")
			||this.expr(element.getAttribute("eventexpr"))
		this.internalQueue.push(new SCxml.InternalEvent(event, element))
		break
	case "send":
		var target=element.getAttribute("target")
			||this.expr(element.getAttribute("targetexpr"))
			||"#_scxml_"+this.sid
		event=element.getAttribute("event")
			||this.expr(element.getAttribute("eventexpr"))

		if(!element.hasAttribute('id'))
			element.setAttribute('id', this.uniqId())
		var id=element.getAttribute("id")
		if(loc=element.getAttribute("idlocation"))
			this.expr(loc+'="'+id+'"')
		var proc=element.getAttribute("type")
			||this.expr(element.getAttribute("typeexpr"))
			||"SCXML"
		var delay=parseInt(element.getAttribute("delay")
			||this.expr(element.getAttribute("delayexpr")))*1000
			||0

		if(target=="#_internal")
		{
			this.internalQueue.push(new SCxml.InternalEvent(event, element))
			break
		}
		
		if(proc in SCxml.EventProcessors)
			proc=SCxml.EventProcessors[proc]
		else
			for(var st in SCxml.EventProcessors)
				if(SCxml.EventProcessors[st].name==proc)
					proc=SCxml.EventProcessors[st]
		if("object" != typeof proc)
			this.error("execution",element,
				new Error('unsupported IO processor "'+proc+'"'))

		var namelist=element.getAttribute("namelist")
		var data={}
		if(namelist)
		{
			namelist=namelist.split(" ")
			for(var i=0, name; name=namelist[i]; i++)
				data[name]=this.expr(name)
		}
		this.readParams(element, data)
		if(c && c.tagName=="content")
			data=c.textContent
		
		var e=proc.createEvent(event, this, data, element)
		if(delay) window.setTimeout(proc.send, delay, e, target, element, this)
		else proc.send(e, target, element, this)
		break
	case "log":
		this.log(element.getAttribute("label")+" = "
			+this.expr(value,element))
		break
	case "data":
		if(!this.lateBinding) break // do not reinitialize again
		var id=element.getAttribute("id")
		// create the variable first, so it's "declared"
		// even if the assignment part fails or doesn't occur
		this.datamodel[id]=undefined
		if(element.hasAttribute("expr"))
			this.expr(id+" = "+value, element)
		else if(value=element.getAttribute("src"))
		{
			// TODO: fetch the data
		}
		break
	case "assign":
		loc=element.getAttribute("location")
		if(!loc) this.error("syntax",element,new Error(
			"'loc' attribute required"))
		this.datamodel._x.dmValue=this.expr(loc, element)
		
		// Now this is a hack to see if 'loc' resolves in datamodel scope
		var globalResolves = true
		try{var globalValue=eval(loc)} catch(err){globalResolves=false}
		if(globalResolves)
		{
			// try assigning a special value in datamodel scope
			this.expr(loc+" = '__SCxmlGlobalCheck__'", element)
			// now see if it shows up in global scope
			if(eval(loc)==='__SCxmlGlobalCheck__')
			{
				eval(loc+" = globalValue") // restore it before throw
				this.error("execution",element,new ReferenceError(
					loc+" is not declared in the datamodel"))
			}
			this.expr(loc+" = _x.dmValue", element)
			delete this.datamodel._x.dmValue
		}
		
		if(value) this.expr(loc+" = "+value, element)
		break
	case "if":
		var cond=this.expr(element.getAttribute("cond"))
		while(!cond && c)
		{
			if(c.tagName=="else") cond=true
			if(c.tagName=="elseif") cond=this.expr(c.getAttribute("cond"))
			c=c.nextElementSibling
		}
		while(c)
		{
			if(c.tagName=="else" || c.tagName=="elseif") break
			this.execute(c)
			c=c.nextElementSibling
		}
		break
	case "foreach":
		var a=this.expr(element.getAttribute("array"))
		var v=element.getAttribute("item")
		var i=element.getAttribute("index")
		if(!(a instanceof Object || "string"==typeof a)
		|| !/^(\$|[^\W\d])[\w$]*$/.test(i)
		|| !/^(\$|[^\W\d])[\w$]*$/.test(v))
			this.error("execution",element,new Error("invalid item, index or array"))
		for(var k in a)
		{
			if(i) this.datamodel[i]=k
			if(v) this.datamodel[v]=a[k]
			for(c=element.firstElementChild; c; c=c.nextElementSibling)
				this.execute(c)
		}
		break
	case "script":
		this.expr(element.textContent,element)
		break
		
	default:
		while(c)
		{
			this.execute(c)
			c=c.nextElementSibling
		}
	}
}
