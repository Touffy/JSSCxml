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

SCxml.parseTime=function (s)
{
	s=/^((?:\d*\.)?\d+)(m?s)$/.exec(s)
	if(!s) return -1
	var t=Number(s[1])
	if(s[2]=="s") t*=1000
	return t
}

// handles executable content
SCxml.prototype.execute=function(element)
{
	if(element.tagName in SCxml.executableContent)
		return SCxml.executableContent[element.tagName](this, element)

	var c=element.firstElementChild
	while(c)
	{
		this.execute(c)
		c=c.nextElementSibling
	}
}

// if you want to add a custom executable element, simply add a method
// to this object, with the name of your new element:
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
		var target=element.getAttribute("target")
			||sc.expr(element.getAttribute("targetexpr"))
			||"#_scxml_"+sc.sid
		var event=element.getAttribute("event")
			||sc.expr(element.getAttribute("eventexpr"))

		if(!element.hasAttribute('id'))
			element.setAttribute('id', sc.uniqId())
		var id=element.getAttribute("id"), loc
		if(loc=element.getAttribute("idlocation"))
			sc.expr(loc+'="'+id+'"')
		var proc=element.getAttribute("type")
			||sc.expr(element.getAttribute("typeexpr"))
			||"SCXML"
		var delay=SCxml.parseTime(element.getAttribute("delay")
			|| sc.expr(element.getAttribute("delayexpr")))

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
		sc.readParams(element, data)
		var c=element.firstElementChild
		if(c && c.tagName=="content")
			data=c.textContent
		
		var e=proc.createEvent(event, sc, data, element)
		if(delay > -1)
			(element.sent || (element.sent=[])).push(
				window.setTimeout(proc.send, delay, e, target, element, sc))
		else proc.send(e, target, element, sc)
	},
	
	cancel: function(sc, element)
	{
		var id=element.getAttribute("sendid")
			||sc.expr(element.getAttribute("sendidexpr"))
		for(var timer, sent=sc.dom.querySelector("send[id="+id+"]").sent;
			timer=sent.pop();)
				try{window.clearTimeout(timer)} catch(err){}
	},
	
	log: function(sc, element)
	{
		var value=element.getAttribute("expr")
		sc.log(element.getAttribute("label")+" = "+sc.expr(value,element))
	},
	
	data: function(sc, element)
	{
		var value=element.getAttribute("expr")
		if(!sc.lateBinding) return // do not reinitialize again
		var id=element.getAttribute("id")
		// create the variable first, so it's "declared"
		// even if the assignment part fails or doesn't occur
		if(id in sc.datamodel._jsscxml_predefined_)
			console.warn("Variable '"+id+"' is shadowing a predefined"
			+ "window variable: please never delete it.\nin", element)
		else sc.datamodel[id]=undefined
		if(element.hasAttribute("expr"))
			sc.expr(id+" = "+value, element)
		else if(value=element.getAttribute("src"))
		{
			// TODO: fetch the data
		}
	},
	
	assign: function(sc, element)
	{
		var value=element.getAttribute("expr")
		var loc=element.getAttribute("location")
		if(!loc) sc.error("syntax",element,new Error("'loc' attribute required"))
		sc.expr(loc, element) // eval once to see if it's been declared
		if(value) sc.expr(loc+" = "+value, element)
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
