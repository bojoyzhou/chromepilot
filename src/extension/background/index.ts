import "./state";
import "./messages";
import "./modules/side-panel";

import { setIconDisconnected } from "./modules/icon-state";
import { connect, setCommandHandler } from "./ws-bridge";
import { handleCommand, registerCdpDispatcher } from "./command-router";
import { registerPanelListener } from "./panel-comm";
import { registerLifecycleListeners } from "./lifecycle";

// Initialize extension
setIconDisconnected();
setCommandHandler(handleCommand);
registerCdpDispatcher();
registerPanelListener();
registerLifecycleListeners();
connect();
