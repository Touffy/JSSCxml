JSSCxml
=======

A JavaScript State Chart interpreter that fully implements the W3C's upcoming [SCXML recommendation](http://www.w3.org/TR/scxml/) in Web browsers.

The name should be pronounced "JessieXML" or just "Jessie".

It is distributed under a MIT license.


### Development status

You can't `<send>` or receive remote events (of any type) with I/O Processors, but you can already use the included custom `<fetch>` element to get similar results in a client-server fashion.

As mentionned above, you can't send SCXML events over HTTP. Support is planned for listening for remote events (from predefined hosts) with the EventSource protocol built-in.

Current Features:

- ECMAScript is the only supported datamodel
- core algorithm is fully conformant with the stable parts of the spec
- all executable content works as specified, except `<send>` in some cases (see above)
- DOM interaction is fully supported
- interpreter JavaScript API including events (documented in dom.html)
- `<fetch>` custom executable element (see fetch.html for documentation)
- incomplete pause/resume functionality (doesn't pause delayed events yet)
- works in WebKit-based browsers

### Known issues
(that I'm not going to fix right now)

- Variables whose name matched a predefined window variable are pre-declared in the datamodel. You should not delete them if you don't understand what it means and how the datamodel is implemented in JSSC.

- The JavaScript expression in the `location` attribute of an `<assign>` element is currently being evaluated twice while executing the `<assign>`. That could cause a bug if it has side-effects. You should perform any such actions in a `<script>`, and use read-only expressions in `location` attributes. Or you can just write the whole assignment in a `<script>`, of course.

- In ECMAScript content, the keyword "this" references a hidden window by default. You should only use it in constructors and object methods, never in a default context, unless you really know what you're doing.