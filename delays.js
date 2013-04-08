/*	Delays:
	wraps setTimeout and setInterval calls so they can be paused and resumed
*/

function Timeout(args, startNow, sc)
{
	this.executed=false
	this.time=args[1]
	this.f=args[0]
	this.args=[]
	this.sc=sc
	for(var i=2; args[i]; i++) this.args.push(args[i])
	if(startNow) this.start()
	else this.sc.timeouts.push(this)
}

Timeout.timesUp=function(t){ t.timesUp() }

Timeout.prototype.start=function()
{
	if(!this.timer && !this.executed)
	{
		this.timer=setTimeout(this.time, Timeout.timesUp, this)
		this.started=+new Date()
	}
}
Timeout.prototype.cancel=function()
{
	if(this.timer && !this.executed){
		clearTimeout(this.timer)
		delete this.timer
	}
}
Timeout.prototype.stop=function()
{
	if(this.timer && !this.executed && this.sc.running){
		this.time-=new Date()-this.started
		if(this.time<15) return false
		clearTimeout(this.timer)
		delete this.timer
		this.sc.timeouts.push(this)
		return true
	}
	return false
}

Timeout.prototype.timesUp=function()
{
	this.executed=true
	try{
		if((typeof this.f)=="function")
			sc.datamodel.call(f, this.args)
		else sc.datamodel.expr(f, f)
	} catch(err){}
}
