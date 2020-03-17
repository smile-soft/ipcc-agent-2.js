/* 
 * To change this template, choose Tools | Templates
 * and open the template in the editor.
 */

window.onerror = function(msg, url, linenumber) {
     console.error('Error message: '+msg+'\nURL: '+url+'\nLine number: '+linenumber);
 };


;(function(window, document){

    var agent,
        dialInput = document.getElementById('dial-input'),
        callBtn = document.getElementById('call-btn'),
        answerBtn = document.getElementById('answer-btn'),
        dropBtn = document.getElementById('drop-btn'),
        holdBtn = document.getElementById('hold-btn'),
        wrapBtn = document.getElementById('wrap-btn'),
        closeBtn = document.getElementById('close-btn'),
        pauseBtn = document.getElementById('pause-btn'),
        confBtn = document.getElementById('conf-btn'),
        processInfo = document.getElementById('process-info'),
        stateInfo = document.getElementById('state-info'),
        exitCode = document.getElementById('exit-code'),
        code,
        comment;

    var storage = window.localStorage;

    if(storage.ClientConnectionParams) init(JSON.parse(storage.ClientConnectionParams));
    else window.initClientModule = init;


    function addEvent(obj, evType, fn) {
      if (obj.addEventListener) obj.addEventListener(evType, fn, false);
      else if (obj.attachEvent) obj.attachEvent("on"+evType, fn);
    }

    function removeEvent(obj, evType, fn) {
      if (obj.removeEventListener) obj.removeEventListener(evType, fn, false);
      else if (obj.detachEvent) obj.detachEvent("on"+evType, fn);
    }

    //get agent state name from state code
    function getFriendlyState(state){
        var fstate;
        if(state === 0)
            fstate = 'Unregistered';
        else if(state === 1)
            fstate = 'Pause';
        else if(state === 3)
            fstate = 'Incoming call';
        else if(state === 4)
            fstate = 'Outgoing call';
        else if(state === 5)
            fstate = 'Connected (incoming call)';
        else if(state === 6)
            fstate = 'Wrap';
        else if(state === 7)
            fstate = 'Generic Task';
        else if(state === 8)
            fstate = 'Idle';
        else if(state === 9)
            fstate = 'Connected (outgoing call)';

        return fstate;
    }

    function init(params){

        if(!params) return console.log('Please, specify connection params');

        storage.ClientConnectionParams = JSON.stringify(params);

        addEvent(callBtn, 'click', call);
        addEvent(answerBtn, 'click', answer);
        addEvent(dropBtn, 'click', drop);
        addEvent(closeBtn, 'click', close);
        addEvent(confBtn, 'click', conf);
        addEvent(pauseBtn, 'click', pause);
        addEvent(holdBtn, 'click', hold);
        addEvent(wrapBtn, 'click', idle);
        
        // Initiate module and subscribe on events
        agent = SmileSoft.Agent(params);

        // agent = SmileSoft.Agent({
        //     websockets: true,
        //     webrtc: true,
        //     sip: {
        //         ws_servers: 'wss://'+connection.wshost,
        //         uri: 'sip:'+connection.clientlogin+'@'+connection.siphost,
        //         password: connection.clientpwd,
        //         display_name: connection.clientname,
        //     }
        // });
        
        agent.on('Error', function (params){
          console.error('Error: ', params);
        });
        
        agent.on('ready', function (){
          console.log('Module initiated');
        });
        
        agent.on('statechange', function (params){
          console.log('onstatechange:', params);
          stateInfo.textContent = JSON.stringify(params);
        });
        
        agent.on('processchange', function (params){
          console.log('onprocesschange:', params);
          processInfo.textContent = JSON.stringify(params);
        });
    }

    function call(){
        var number = dialInput.value;
        agent.call(number.toString());
    }

    function answer(){
        agent.answer();
    }

    function conf(){
        agent.conference();
    }

    function hold(){
        agent.hold();
    }

    function drop(){
        agent.drop();
    }

    function idle(){
        agent.idle();
    }

    function close(){
        code = exitCode.value;
        if(code === '' || code === undefined) return;
        agent.close(agent.process.pid, parseInt(code, 10));
    }

    function pause(){
        if(agent.state === 1) {
            agent.idle();
        } else {
            code = window.prompt('Set pause state', 63);
            comment = window.prompt('Set pause comment', 'Work pause');
            if(code !== '' && code !== undefined) agent.pause(parseInt(code, 10), comment);
        }
    }

})(window, document);
