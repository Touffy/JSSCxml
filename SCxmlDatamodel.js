
SCxml.EventProcessors={
	SCXML:{
		name:"http://www.w3.org/TR/scxml/#SCXMLEventProcessor",
		createEvent: function(name, sc, data)
		{
			return new SCxml.ExternalEvent(event, sc.sid, "", "", data)
		},
		send: function(target, event, element, sc)
		{
			console.log("sending a "+event.name+" event to "+target)
			var sid
			if((sid=target.match(/^#_scxml_(.+)$/)) && (sid=sid[1]))
			{
				if(sid in SCxml.sessions && SCxml.sessions[sid])
					SCxml.sessions[sid].onEvent(event)
				else throw "target SCXML session doesn't exist"
			}
			else {
				sc.error("execution",element,
					new Error('unsupported target "'+target+'" for SCXML events'))
			} // TODO
		}
	},
	basichttp:{
		name:"http://www.w3.org/TR/scxml/#BasicHTTPEventProcessor"
	},
	DOM:{
		name:"http://www.w3.org/TR/scxml/#DOMEventProcessor",
		createEvent: function(name, sc, data)
		{
			// this is the ugly DOM 3 version to improve compatibility
			var e=document.createEvent("CustomEvent")
			e.initCustomEvent(name, true, false, data)
			return e
		},
		send: function(event, target, element, sc)
		{
			var obj
			// heuristics to determine target syntax (XPath or CSS)
			if(!target) obj=sc.html
			if(!obj) try{
				if(target[0]=="/") obj=document.evaluate(
					target, sc.html, null, 9, null).singleNodeValue
				if(target[0]=="#") obj=document.querySelector(target)
			}catch(err){ sc.error("execution.DOM",element,err) }
			
			if(!obj) try{ obj=document.evaluate(
				target, sc.html, null, 9, null).singleNodeValue
				}catch(err){}
			if(!obj) try{ obj=document.querySelector(target) }catch(err){}
			
			if(!obj) sc.error("execution.DOM",element,
				new Error('Failed to evaluate "'+target+'" to an existing element'))
			
			console.log("sending a "+event.type+" event to ",obj)
			
			obj.dispatchEvent(event)
		}
	}
}
/*
This is necessary for the In method to work flawlessly.
By using a closure, I let In() access the configuration
without adding the name 'configuration' to the datamodel.
*/
SCxml.Datamodel=function SCxmlDatamodel(sc)
{
	this.In=function In(state){ return state in sc.configuration }
	this._sessionid=sc.sid
}
SCxml.Datamodel.prototype={
	_event:undefined,
	_name:"",
	_ioprocessors:SCxml.EventProcessors,
	_x:{
	
	/*
	_x.declare() registers top-level datamodel variable names.
	
	normal global declarations, using var and function statements:
	
	    var myVar
	    var myVar2 = "initial value"
	    function myGlobalFunction() {}
	
	using _x.declare with string arguments :
	
	    _x.declare("myVar", "myVar2", "myGlobalFunction")
	    myVar2 = "initial value"
	    myGlobalFunction = function() {}
	
	using _x.declare with an object lets you provide initial values too :
	
	    _x.declare({
	    	myVar: undefined,
	    	myVar2: "initial value",
	    	myGlobalFunction: function() {}
	    })
	 
	mixed arguments :
	 
	    _x.declare("myVar", {
	    	myVar2: "initial value",
	    	myGlobalFunction: function() {}
	    })
	
	Local variables are not affected, you must still use var statements for them.
	_x.declare will always create global variables, no matter where it is used
	in your scripts.
	*/
	declare:function()
	{
		for(var i=0; i<arguments.length; i++)
		{
			if("object"==typeof arguments[i])
				for(var p in arguments[i])
					this[p]=arguments[i][p]
			else this[arguments[i]]=undefined
		}
	}},
	
	// these are here to prevent direct HTML DOM access from SCXML scripts
	
	document:undefined,
	window:undefined,
	history:undefined,
	navigator:undefined
}
