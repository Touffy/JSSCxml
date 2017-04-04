SCxml.prototype.mutationRequiresRestart=function()
{

}

SCxml.prototype.initObservers=function()
{
	this.obs={}
	for(var i in SCxml.mutations){
		this.obs[i]=new MutationObserver(SCxml.mutations[i]),
		this.obs[i].sc=this
	}
}

SCxml.mutations={
	scxml:function (mutations, obs)
	{
		for(var i in mutations){
			var e=mutations[i].target
			if(mutations[i].type=="attributes")
			switch(mutations[i].attributeName){
			case "initial":
				obs.sc.checkTargets(e.getAttribute("initial"), e)
				// TODO: draw initial arrow (whenever that is implemented…)
				break
			case "name":
				obs.sc.name = e.getAttribute("name")
					|| obs.sc.iid || ("session"+obs.sc.sid)
				break
			case "binding": with(mutations[i].target){
				if(hasAttribute("binding")
				&& getAttribute("binding") != "early"
				&& getAttribute("binding") != "late")
					console.warn("binding='"+getAttribute("binding")+"' in"
					+ obs.sc.name +" is not valid")
				obs.sc.lateBinding=(getAttribute("binding")=="late")
				}
				obs.sc.mutationRequiresRestart()
			}
			else if(mutations[i].addedNodes.length){
				// TODO: check that the new id is not already in use
				var newChild=mutations[i].addedNodes[0]
				newChild._JSSCID=obs.sc.lastJSSCID++
				obs.sc.JSSCID[newChild._JSSCID]=newChild
				switch(newChild.localName){
				case "state":
				case "parallel":
				case "final":
					obs.sc.newTarget(newChild)
					break
				}
			}
		}
	},
	state:function (mutations, obs)
	{
		for(var i in mutations){
			var e=mutations[i].target
			if(mutations[i].type=="attributes")
			switch(mutations[i].attributeName){
			case "initial":
				obs.sc.checkTargets(e.getAttribute("initial"), e)
				obs.sc.view.drawTransition(e.ui)
				break
			case "id":
				// TODO: check that the new id is not already in use
				// TODO: refactor transition targetting this state?
				obs.sc.renameTarget(mutations[i].oldValue, e)
			}
			else if(mutations[i].addedNodes.length){
				// TODO: check that the new id is not already in use
				var newChild=mutations[i].addedNodes[0]
				newChild._JSSCID=obs.sc.lastJSSCID++
				obs.sc.JSSCID[newChild._JSSCID]=newChild
				switch(newChild.localName){
				case "state":
				case "parallel":
				case "final":
					obs.sc.newTarget(newChild)
					if(e.getAttribute("active") && SCxml.subStates(e).length==1)
					{
						obs.sc.addStatesToEnter(newChild, newChild.parentNode)
						obs.sc.html.dispatchEvent(new CustomEvent("enter", {detail:
						{list: obs.sc.statesToEnter.inEntryOrder()
							.filter(obs.sc.enterState,obs.sc).map(getId)} }))
					}
					break
				case "history":
					obs.sc.newTarget(newChild)
					break
				case "transition":
					break
				}
			}
		}
	},
	parallel:function (mutations, obs)
	{
		for(var i in mutations){
			var e=mutations[i].target
			if(mutations[i].type=="attributes"
			&& mutations[i].attributeName=="id"){
				// TODO: check that the new id is not already in use
				// TODO: refactor transition targetting this state?
				obs.sc.renameTarget(mutations[i].oldValue, e)
			}
			else if(mutations[i].addedNodes.length){
				// TODO: check that the new id is not already in use
				var newChild=mutations[i].addedNodes[0]
				newChild._JSSCID=obs.sc.lastJSSCID++
				obs.sc.JSSCID[newChild._JSSCID]=newChild
				switch(newChild.localName){
				case "state":
				case "parallel":
				case "final":
					obs.sc.newTarget(newChild)
					if(e.getAttribute("active"))
					{
						obs.sc.addStatesToEnter(newChild, newChild.parentNode)
						obs.sc.html.dispatchEvent(new CustomEvent("enter", {detail:
						{list: obs.sc.statesToEnter.inEntryOrder()
							.filter(obs.sc.enterState,obs.sc).map(getId)} }))
					}
					break
				case "history":
					obs.sc.newTarget(newChild)
					break
				case "transition":
					break
				}
			}
		}
	},
	transition:function (mutations, obs)
	{
		for(var i in mutations){
			var e=mutations[i].target
			switch(mutations[i].attributeName){
			case "event":
			case "cond":
			case "type":
			// someday: update the "next step" display
				break
			case "target":
			case "targetexpr":
				var oldTargets=e.targets
				// clear targets' reverse links
				if(oldTargets && oldTargets.size && obs.sc.resolve(oldTargets))
					for(var j=0, t; t=oldTargets[j]; j++)
						obs.sc.targets[t.getAttribute("id")].delete(e._JSSCID)
				var expr=false
				// maybe recompute target set and reverse
				if(!e.getAttribute("target")){
					e.targets=new Set()
					if(e.ui) obs.sc.view.clearArrows(e.ui)
					expr=!!e.getAttribute("targetexpr")
				} else {
					obs.sc.checkTargets(e.getAttribute("target"), e)
					if(e.ui) obs.sc.view.drawTransition(e.ui)
				}
			}
		}
	}
}

SCxml.prototype.newTarget=function(s)
{
	var newId=s.getAttribute("id")
	s.executeAfterEntry=[]
	if(s.tagName=="parallel") s.initial=[]
	else if(s.hasAttribute('initial'))
		this.checkTargets(s.getAttribute('initial'), s)
	if(this.obs && s.localName in this.obs)
		this.obs[s.localName].observe(s, SCxml.observerOptions[s.localName])

	if(this.view)
		s.parentNode.ui.appendChild(this.view.convertNode(s))
	if(newId in this.missingTargets){
		for(let t of this.missingTargets[newId]){
			this.JSSCID[t].targets.add(s._JSSCID)
			if(this.JSSCID[t].ui) this.view.drawTransition(this.JSSCID[t].ui)
		}
		this.targets[newId]=this.missingTargets[newId]
		delete this.missingTargets[newId]
	}
}

SCxml.prototype.renameTarget=function(oldId, s)
{
	var newId=s.getAttribute("id")
	if(s.ui) s.ui.setAttribute("scid", newId)
	if(oldId in this.targets){
		for(let t of this.targets[oldId]){
			this.JSSCID[t].targets.delete(s._JSSCID)
			if(this.JSSCID[t].ui) this.view.drawTransition(this.JSSCID[t].ui)
		}
		this.missingTargets[oldId]=this.targets[oldId]
		delete this.targets[oldId]
	}
	if(newId in this.missingTargets){
		for(let t of this.missingTargets[newId]){
			this.JSSCID[t].targets.add(s._JSSCID)
			if(this.JSSCID[t].ui) this.view.drawTransition(this.JSSCID[t].ui)
		}
		this.targets[newId]=this.missingTargets[newId]
		delete this.missingTargets[newId]
	}
}

SCxml.observerOptions={
	scxml:{
		childList: true,
		attributes:true,
		attributeFilter: ["initial", "name", "binding"]
	},
	state:{
		childList: true,
		attributes:true,
		attributeFilter: ["id","initial"],
		attributeOldValue:true
	},
	parallel:{
		childList: true,
		attributes:true,
		attributeFilter: ["id"],
		attributeOldValue:true
	},
	transition:{
		attributes:true,
		attributeFilter: ["event", "cond", "target", "targetexpr", "type"]
	},
	initial:{childList: true},
	"final":{
		childList: true,
		attributes:true,
		attributeFilter: ["id"],
		attributeOldValue:true
	},
	onentry:{childList: true},
	onexit:{childList: true},
	donedata:{childList: true},
	history:{
		childList: true,
		attributes:true,
		attributeFilter: ["id","type"],
		attributeOldValue:true
	},
	
	datamodel:{childList: true},
	script:{
		childList: true,
		attributes:true,
		attributeFilter: ["src"]
	},
	
	invoke:{
		childList: true,
		attributes:true,
		attributeFilter: ["id","idlocation","type","typeexpr","src","srcexpr",
			"autoforward"]
	},
	finalize:{childList: true}
}