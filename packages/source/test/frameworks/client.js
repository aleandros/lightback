import { createLightback, toPromptContext } from '@lightback/core';
import { start } from './framework.js';
const reports = [];
const client = createLightback({ persistence: false, context: { retained: true }, send: async (payload) => { reports.push({ payload, prompt: toPromptContext(payload) }); } });
const original = document.querySelector('[data-testid=target]');
let instance = start(client, true, true);
let second;
let secondClient;
window.fixture = {
  client, reports, original,
  mountSecond() {
    const target = document.createElement('div'); target.id = 'second'; document.body.append(target);
    secondClient = createLightback({persistence:false, context:{scope:'second'}});
    second = start(secondClient, false, false, '#second');
  },
  secondPayload() { return secondClient.buildPayload({text:''}); },
  async removeSecond() { await second.unmount(); secondClient.destroy(); document.querySelector('#second').remove(); },
  update(value) { instance.update(value); },
  unmount() { return instance.unmount(); },
  remount(widget = true) { instance = start(client, false, widget); },
};
