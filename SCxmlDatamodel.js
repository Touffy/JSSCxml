
SCxml.EventProcessors={
	SCXML:{name:"http://www.w3.org/TR/scxml/#SCXMLEventProcessor"},
	basichttp:{name:"http://www.w3.org/TR/scxml/#BasicHTTPEventProcessor"},
	DOM:{name:"http://www.w3.org/TR/scxml/#DOMEventProcessor"}
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
