JSSCxml
=======

A JavaScript State Chart interpreter that fully implements the W3C's upcoming [SCXML recommendation](http://www.w3.org/TR/scxml/) in Web browsers.

The name should be pronounced "JessieXML" or just "Jessie".

It is distributed under a MIT license.

Official website: [jsscxml.org](http://www.jsscxml.org/)


### Main Features:

- ECMAScript is the only supported datamodel
- core algorithm is fully conformant
- all executable content works as specified, except `<send>` in some cases (see below)
- DOM Event I/O
- [JavaScript API including events](http://www.jsscxml.org/api.html)
- [`<fetch>` custom executable element](http://www.jsscxml.org/fetch.html)
- [connection-like `invoke`](http://www.jsscxml.org/connect.html)
- [speech synthesis extensions](http://www.jsscxml.org/speak.html)
- pause/resume functionality (also pauses delayed events' and setTimeout timers)
- [graphical debugger](http://www.jsscxml.org/viewer.html)
- works in WebKit-based browsers

### Development status

Latest version: [0.9.0](http://www.jsscxml.org/versions/SCxml_latest.zip)

See the [version history and goals](http://www.jsscxml.org/dev.html).

You can't `<send>` or receive remote events (of any type) with I/O Processors, but you can already use the included custom `<fetch>` and `<invoke type="event-stream">` elements to get similar results in a client-server fashion.

As mentionned above, you can't `<send>` SCXML events over HTTP. But you can listen to remote events after invoking a connection with event-stream type.

### Known issues
(that I'm not going to fix right now)

- Variables whose name matched a predefined window variable are pre-declared in the datamodel. You should not delete them if you don't understand what it means and how the datamodel is implemented in JSSC.

- The JavaScript expression in the `location` attribute of an `<assign>` element is currently being evaluated twice while executing the `<assign>`. That could cause a bug if it has side-effects. You should perform any such actions in a `<script>`, and use read-only expressions in `location` attributes. Or you can just write the whole assignment in a `<script>`, of course.

- In ECMAScript content, the keyword "this" references a hidden window by default. You should only use it in constructors and object methods, never in a default context, unless you really know what you're doing.