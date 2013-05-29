
SCxml.invokeTypes["event-stream"]=
{
	name: 'http://www.jsscxml.org/event-stream/',
	open: function(target, data, id, psc){
		try{ var stream=new EventSource(target) }
		catch(err){ psc.error("communication."+id, this, err) }
		stream.iid=id
		psc.invoked[id]=stream
		stream.parent=psc
		stream.sharedData=data
		stream.onmessage=SCxml.invokeTypes["event-stream"].onmessage
		stream.onerror=SCxml.invokeTypes["event-stream"].onerror
		stream.clean=SCxml.invokeTypes["event-stream"].clean
		stream.fireEvent=SCxml.invokeTypes["event-stream"].noSend
		return stream
	},
	
	noSend: function(){
		this.parent.error("communication."+this.iid, this, new Error(
			"Cannot send events over this connection"))
	},
	
	onmessage: function(message){
		var name=message.data.match(/^\s*(\w+(?:\.\w+)?)/)
		name=name?name[1]:"message."+this.iid
		var data=message.data.replace(/^.*\n/, "")
		if(data) try{ data=JSON.parse(data) }catch(err){}
		else data=undefined
		var e=new SCxml.ExternalEvent(name, "#_"+this.iid, "event-stream",
			this.iid, data)
		e.timeStamp=message.timeStamp
		
		// done.* event => terminate the connection after queuing it
		if(/^done\b/.test(name)) this.sendNoMore=true
		
		this.parent.fireEvent(e)
		if(/^done\b/.test(name)) this.clean()
	},
	
	onerror: function(){
		if(this.readyState==EventSource.CLOSED){
			this.parent.error("communication."+this.iid, this, new Error(
				"Cannot establish event-stream connection to "+this.url), true)
			this.clean()
		}
	},
	clean: function(){
		this.sendNoMore=true
		this.close()
		delete this.parent.invoked[this.iid]
		delete this.parent
	}
}
