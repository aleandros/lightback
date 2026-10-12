---
layout: home
hero:
  name: Lightback
  text: Point at the problem. Send the context.
  tagline: In-app feedback with the element, the screenshot, and the trail that led there. Delivered to your own backend.
  actions:
    - theme: brand
      text: Try the demo
      link: https://aleandros.github.io/lightback/demo/
    - theme: alt
      text: Get started
      link: /guide/getting-started
features:
  - title: Point at anything
    details: Click an element or drag an area. Add a comment right where the problem is, with a screenshot crop for each selection.
  - title: Context a model can use
    details: Component chains, available source locations, console, errors, network calls, and breadcrumbs travel with the report.
  - title: Your backend
    details: Receive JSON and attachments at your endpoint or supply a send function. No hosted service or account required.
---

<div class="lb-home">

## A small addition to your app

```sh
pnpm add @lightback/core @lightback/widget
```

```ts
import { createLightback } from '@lightback/core';
import { mountWidget } from '@lightback/widget';

const client = createLightback({ endpoint: '/api/feedback' });
mountWidget({ client });
```

Mount after the DOM is ready. Add an optional screenshot capturer to include the images shown below. Works with React, Vue, Svelte, or plain JavaScript.

## From “this is broken” to a report you can use

<div class="lb-gallery">
  <figure>
    <img src="./assets/pick-hover.png" alt="Hovering highlights the element under the pointer" loading="lazy" width="2560" height="1600">
    <figcaption><strong>01 · Point.</strong> Pick an element or drag across the area you mean.</figcaption>
  </figure>
  <figure>
    <img src="./assets/region-popover.png" alt="A comment box beside a selected region of an export dialog" loading="lazy" width="2560" height="1600">
    <figcaption><strong>02 · Comment.</strong> Keep the note attached to the thing you selected.</figcaption>
  </figure>
  <figure>
    <img src="./assets/sending.png" alt="Sending feedback card with Edit and Cancel buttons" loading="lazy" width="2560" height="1600">
    <figcaption><strong>03 · Send.</strong> A five-second window lets you cancel or edit.</figcaption>
  </figure>
  <figure>
    <img src="./assets/inbox-summary.png" alt="Example receiver displaying component details and screenshot crops" loading="lazy" width="2560" height="1600">
    <figcaption><strong>04 · Investigate.</strong> Your receiver gets the context. This inbox is the example app.</figcaption>
  </figure>
</div>

[Install Lightback →](./guide/getting-started.md) · [Build your receiver →](./guide/backend.md)

</div>
