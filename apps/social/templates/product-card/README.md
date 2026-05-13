# Template: product-card

A simple two-zone layout: stacked headline / lede in the top region, brand + date footer at the bottom. Adapts to any Instagram aspect ratio because it uses `100vw`/`100vh` and a grid that grows the body region.

## Usage

1. In your post's `index.html`, link the template stylesheet alongside the shared brand stylesheets:

   ```html
   <link rel="stylesheet" href="/shared/reset.css" />
   <link rel="stylesheet" href="/shared/brand.css" />
   <link rel="stylesheet" href="/templates/product-card/template.css" />
   <link rel="stylesheet" href="./style.css" />
   ```

2. Copy the HTML from `template.html` into the post's `<body>` and replace the placeholder text.

3. Override anything you want in the post's own `style.css` (e.g. swap the background color, change the title font, add an image).

## Slots

| Class | Purpose |
| --- | --- |
| `.tpl-product-card__eyebrow` | Small uppercase label (category, date, etc.) |
| `.tpl-product-card__title` | Main headline |
| `.tpl-product-card__lede` | Supporting paragraph |
| `.tpl-product-card__brand` | Footer wordmark |
