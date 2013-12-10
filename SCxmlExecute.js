// just declares datamodel variables as undefined
SCxml.prototype.declare=function(element)
{
	var c=element.firstElementChild
	if(element.tagName=="data")
	{
		var id=element.getAttribute("id")
		if(id in this.datamodel._jsscxml_predefined_)
			console.warn("Variable '"+id+"' is shadowing a predefined"
			+ "window variable: please never delete it.\nin", element)
		else this.datamodel[id]=undefined
	}
	else while(c)
	{
		this.declare(c)
		c=c.nextElementSibling
	}
}

SCxml.prototype.assign=function(left, right)
{
	if(left in this.datamodel._jsscxml_predefined_)
		this.datamodel._jsscxml_predefined_[left]=right
	else this.datamodel[left]=right
}

SCxml.prototype.readParams=function(element, data, alsoContent)
{
	for(var c=element.firstElementChild; c; c=c.nextElementSibling)
	{
		if(c.tagName=="param"){
			var name=c.getAttribute("name")
			var value=c.getAttribute("expr") || c.getAttribute("location")
			if(data.hasOwnProperty(name))
			{
				if(data[name] instanceof Array)
					data[name].push(this.expr(value, c))
				else data[name] = [data[name], this.expr(value, c)]
			}
			else data[name] = this.expr(value, c)
		}
		else if(alsoContent && c.tagName=="content")
			return data=this.readContent(c)
	}
	return data
}

SCxml.prototype.readContent=function(c)
{
	if(c.hasAttribute("expr"))
		return this.expr(c.getAttribute("expr"), c)
	var value
	if(value=c.firstElementChild){ // XML content
		if(value==c.lastElementChild){
			var tmp=sc.dom.implementation.createDocument(
				value.namespaceURI, value.localName)
			for(var c=value.firstChild; c; c=c.nextSibling)
				tmp.documentElement.appendChild(tmp.importNode(c, true))
		}else{
			value=sc.dom.createDocumentFragment()
			for(var c=element.firstChild; c; c=c.nextSibling)
				value.appendChild(c.cloneNode(true))
		}
		return value
	}
	if(value=c.textContent){	// JSON or normalized text content
		try{ return JSON.parse(value) }
		catch(err){ return value.replace(/^\s*|\s*$/g, "").replace(/\s+/g," ")}
	}
	return null
}

SCxml.parseTime=function (s)
{
	s=/^((?:\d*\.)?\d+)(m?s)$/.exec(s)
	if(!s) return -1
	var t=Number(s[1])
	if(s[2]=="s") t*=1000
	return t
}

// handles executable content, including custom namespaced (or not)
SCxml.prototype.execute=function(element)
{
	if(element.namespaceURI==this.dom.documentElement.namespaceURI){
		if(element.localName in SCxml.executableContent)
			return SCxml.executableContent[element.localName](this, element)
		else if(element.localName in SCxml.executableContentNS.tolerate){
			console.warn("executable element <"+element.tagName+"> should not use default namespace")
			return SCxml.executableContentNS.tolerate[element.localName](this, element)
		}
		else{
			var c=element.firstElementChild
			while(c)
			{
				this.execute(c)
				c=c.nextElementSibling
			}
		}
	}
	else{
		if(element.namespaceURI in SCxml.executableContentNS){
			if(element.localName in SCxml.executableContentNS[element.namespaceURI])
				return SCxml.executableContentNS[element.namespaceURI][element.localName](this, element)
			else console.warn("executable element <"+element.tagName+"> is not defined in namespace "+element.namespaceURI)
		}
		else if(element.localName in SCxml.executableContentNS.tolerate){
			console.warn("executable element <"+element.tagName+"> should use its own namespace")
			return SCxml.executableContentNS.tolerate[element.localName](this, element)
		}
		else console.warn("missing executable content extension for namespace "+element.namespaceURI+" used with element <"+element.tagName+">")
	}
}

// if you want to add a custom executable element, add a property
// to this object named for your namespace URI, and within that,
// a method with the name of your element
SCxml.executableContentNS={tolerate:{}}

SCxml.executableContent={

	raise: function(sc, element)
	{
		var event=element.getAttribute("event")
			||sc.expr(element.getAttribute("eventexpr"))
		event=new SCxml.InternalEvent(event, element)
		sc.html.dispatchEvent(new CustomEvent("queue", {detail:event}))
		sc.internalQueue.push(event)
	},
	
	send: function(sc, element)
	{
		if(sc.sendNoMore) return; // prevent <send> from terminated SCs
		var target=element.getAttribute("target")
			||sc.expr(element.getAttribute("targetexpr"), element)
		var event=element.getAttribute("event")
			||sc.expr(element.getAttribute("eventexpr"), element)

		if(!element.hasAttribute('id'))
			element.setAttribute('id', sc.uniqId())
		var id=element.getAttribute("id"), loc
		if(loc=element.getAttribute("idlocation"))
			sc.expr(loc+'="'+id+'"')
		var proc=element.getAttribute("type")
			||sc.expr(element.getAttribute("typeexpr"), element)
			||"SCXML"
		var delay=SCxml.parseTime(element.getAttribute("delay")
			|| sc.expr(element.getAttribute("delayexpr"), element))

		if(target=="#_internal"){
			var e=new SCxml.InternalEvent(event, element)
			sc.html.dispatchEvent(new CustomEvent("queue", {detail:e}))
			sc.internalQueue.push(e)
			return
		}
		
		if(proc in SCxml.EventProcessors)
			proc=SCxml.EventProcessors[proc]
		else
			for(var st in SCxml.EventProcessors)
				if(SCxml.EventProcessors[st].name==proc)
					proc=SCxml.EventProcessors[st]
		if("object" != typeof proc)
			sc.error("execution",element,
				new Error('unsupported IO processor "'+proc+'"'))

		var namelist=element.getAttribute("namelist")
		var data={}
		if(namelist)
		{
			namelist=namelist.split(" ")
			for(var i=0, name; name=namelist[i]; i++)
				data[name]=sc.expr(name)
		}
		data=sc.readParams(element, data, true)
		
		var e=proc.createEvent(event, sc, data, element)
		if(delay > -1)
			(element.sent || (element.sent=[])).push(
				new Delay(delay, !sc.paused, sc, proc, e, target, element))
		else proc.send(e, target, element, sc)
	},
	
	cancel: function(sc, element)
	{
		var id=element.getAttribute("sendid")
			||sc.expr(element.getAttribute("sendidexpr"))
		for(var timer, sent=sc.dom.querySelector("send[id="+id+"]").sent;
			timer=sent.pop(); timer.cancel());
	},
	
	log: function(sc, element)
	{
		var value=element.getAttribute("expr")
		sc.log(element.getAttribute("label")+" = "+sc.expr(value,element))
	},
	
	data: function(sc, element)
	{
		var value=element.getAttribute("expr")
		var id=element.getAttribute("id")
		// create the variable first, so it's "declared"
		// even if the assignment part fails or doesn't occur
		if(id in sc.datamodel._jsscxml_predefined_)
			console.warn("Variable '"+id+"' is shadowing a predefined"
			+ "window variable: please never delete it.\nin", element)
		else sc.datamodel[id]=undefined
		if(element.hasAttribute("expr")){
			sc.expr(id+" = "+value, element)
			return
		}
		if(element.hasAttribute("src"))
			console.warn("You should use <fetch> instead of <data src>, which may render the interpreter unresponsive.")
		else if(value=element.firstElementChild){ // XML content
			if(value==element.lastElementChild){
				var tmp=sc.dom.implementation.createDocument(
					value.namespaceURI, value.localName)
				for(var c=value.firstChild; c; c=c.nextSibling)
					tmp.documentElement.appendChild(tmp.importNode(c, true))
			}else{
				value=sc.dom.createDocumentFragment()
				for(var c=element.firstChild; c; c=c.nextSibling)
					value.appendChild(c.cloneNode(true))
			}
			sc.assign(id, value)
		}
		else if(value=element.textContent){	// JS or normalized text content
			var tmp=sc.datamodel.syntexpr(value) // see if it is valid JS
			if(tmp instanceof sc.datamodel.SyntaxError)
				tmp=value.replace(/^\s*|\s*$/g, "").replace(/\s+/g," ")
			sc.assign(id, tmp)
		}
	},
	
	assign: function(sc, element)
	{
		var value=element.getAttribute("expr")
		var loc=element.getAttribute("location")
		if(!loc) sc.error("syntax",element,new Error("'loc' attribute required"))
		value=sc.expr(loc+" = "+value, element)
		if(sc.expr(loc, element) != value)
			sc.error("execution",element,new Error("cannot assign to read-only property"))
	},
	
	"if": function(sc, element)
	{
		var cond=sc.expr(element.getAttribute("cond"))
		var c=element.firstElementChild
		while(!cond && c)
		{
			if(c.tagName=="else") cond=true
			if(c.tagName=="elseif") cond=sc.expr(c.getAttribute("cond"))
			c=c.nextElementSibling
		}
		while(c)
		{
			if(c.tagName=="else" || c.tagName=="elseif") break
			sc.execute(c)
			c=c.nextElementSibling
		}
	},
	
	foreach: function(sc, element)
	{
		var a=sc.expr(element.getAttribute("array"))
		var v=element.getAttribute("item")
		var i=element.getAttribute("index")
		if(("object"!=typeof a) && ("string"!=typeof a))
			sc.error("execution",element,new TypeError("Invalid array"))
		if(i && !/^(\$|[^\W\d])[\w$]*$/.test(i))
			sc.error("execution",element,new SyntaxError("Invalid index"))
		if(v && !/^(\$|[^\W\d])[\w$]*$/.test(v))
			sc.error("execution",element,new SyntaxError("Invalid item"))
		
		for(var k in a)
		{
			if(i) sc.assign(i,k)
			if(v) sc.assign(v,a[k])
			for(var c=element.firstElementChild; c; c=c.nextElementSibling)
				sc.execute(c)
		}
	},
	
	script: function(sc, element)
	{
		sc.wrapScript(element.textContent,element)
	}
}
