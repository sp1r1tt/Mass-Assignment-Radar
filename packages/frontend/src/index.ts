import { Classic } from "@caido/primevue";
import PrimeVue from "primevue/config";
import { createApp } from "vue";

import { SDKPlugin } from "./plugins/sdk";
import "./styles/index.css";
import type { FrontendSDK } from "./types";
import App from "./views/App.vue";

const Commands = {
  sendToRadar: "mass-assignment-radar.send-to-radar",
  sendRawToRadar: "mass-assignment-radar.send-raw-to-radar",
  openRadar: "mass-assignment-radar.open",
} as const;

// This is the entry point for the frontend plugin
export const init = (sdk: FrontendSDK) => {
  sdk.commands.register(Commands.sendToRadar, {
    name: "Send to Mass Assignment Radar",
    run: async (context) => {
      if (context.type === "RequestRowContext") {
        const first = context.requests[0];
        if (first !== undefined) {
          await sdk.storage.set({
            incomingRequest: {
              id: String(first.id),
              host: first.host,
              port: first.port,
              path: first.path,
              query: first.query,
              isTls: first.isTls,
            },
          });
          sdk.navigation.goTo("/mass-assignment-radar");
          sdk.window.showToast("Request sent to Mass Assignment Radar", {
            variant: "success",
          });
        }
      } else if (context.type === "ResponseContext") {
        await sdk.storage.set({
          incomingRequest: {
            id: String(context.request.id),
            host: context.request.host,
            port: context.request.port,
            path: context.request.path,
            query: context.request.query,
            isTls: context.request.isTls,
          },
        });
        sdk.navigation.goTo("/mass-assignment-radar");
        sdk.window.showToast("Request sent to Mass Assignment Radar", {
          variant: "success",
        });
      }
    },
    group: "Mass Assignment Radar",
    when: (context) =>
      context.type === "RequestRowContext" ||
      context.type === "ResponseContext",
  });

  sdk.commands.register(Commands.sendRawToRadar, {
    name: "Send to Mass Assignment Radar",
    run: async (context) => {
      if (context.type !== "RequestContext") {
        return;
      }

      const result = await sdk.backend.saveRequestFromRaw({
        host: context.request.host,
        port: context.request.port,
        isTls: context.request.isTls,
        raw: context.request.raw,
      });
      if (result.kind === "Error") {
        sdk.window.showToast(result.error, { variant: "error" });
        return;
      }

      await sdk.storage.set({
        incomingRequest: {
          id: result.value.id,
          host: context.request.host,
          port: context.request.port,
          path: context.request.path,
          query: context.request.query,
          isTls: context.request.isTls,
        },
      });
      sdk.navigation.goTo("/mass-assignment-radar");
      sdk.window.showToast("Request sent to Mass Assignment Radar", {
        variant: "success",
      });
    },
    group: "Mass Assignment Radar",
    when: (context) => context.type === "RequestContext",
  });

  sdk.commands.register(Commands.openRadar, {
    name: "Open Mass Assignment Radar",
    run: () => {
      sdk.navigation.goTo("/mass-assignment-radar");
    },
    group: "Mass Assignment Radar",
  });

  sdk.commandPalette.register(Commands.openRadar);

  sdk.menu.registerItem({
    type: "RequestRow",
    commandId: Commands.sendToRadar,
    leadingIcon: "fas fa-bullseye",
  });

  sdk.menu.registerItem({
    type: "Response",
    commandId: Commands.sendToRadar,
    leadingIcon: "fas fa-bullseye",
  });

  sdk.menu.registerItem({
    type: "Request",
    commandId: Commands.sendRawToRadar,
    leadingIcon: "fas fa-bullseye",
  });

  const app = createApp(App);

  // Load the PrimeVue component library
  app.use(PrimeVue, {
    unstyled: true,
    pt: Classic,
  });

  // Provide the FrontendSDK
  app.use(SDKPlugin, sdk);

  // Create the root element for the app
  const root = document.createElement("div");
  Object.assign(root.style, {
    height: "100%",
    width: "100%",
  });

  // Set the ID of the root element
  // Replace this with the value of the prefixWrap plugin in caido.config.ts
  // This is necessary to prevent styling conflicts between plugins
  root.id = `plugin--mass-assignment-radar`;

  // Mount the app to the root element
  app.mount(root);

  // Add the page to the navigation
  // Make sure to use a unique name for the page
  sdk.navigation.addPage("/mass-assignment-radar", {
    body: root,
  });

  // Add a sidebar item
  sdk.sidebar.registerItem("Radar", "/mass-assignment-radar", {
    icon: "fa-solid fa-shield-cat",
  });
};
