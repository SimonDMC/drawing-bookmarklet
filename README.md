# Drawing Bookmarklet

![Demo](https://github.com/SimonDMC/drawing-bookmarklet/assets/46278840/eab68ff2-b2c2-4348-a53c-1dd75f7f3d25)

This bookmarklet provides an easy and intuitive way to draw over web pages, with tons of customization.

While in drawing mode, **press H** to view all features.

To exit drawing mode, either press the escape key or click the bookmarklet again.

## Usage

To add the bookmarklet to your bookmark bar, head over to https://simondmc.com/drawing-bookmarklet since Markdown does not support JavaScript links.

## Safety

In general, bookmarklets are dangerous as they can steal session tokens and/or cookies. This bookmarklet sends zero requests over the internet and works perfectly fine while offline (unless the remote version is installed).

As the minified version is hard to read and therefore to verify its legitimacy, you are more than welcome to verify the [unminified version](https://github.com/SimonDMC/drawing-bookmarklet/blob/main/drawing.js) and run it through a minifier of your choice (for example [Terser](https://try.terser.org/)).

This also means absolutely no telemetry data is collected.

## Features

H - Open the help menu

General:

-   E - Erase the canvas
-   Esc - Close modal / Exit drawing mode
-   ↑ / Scroll up - Increase brush size
-   ↓ / Scroll down - Decrease brush size
-   S - Reset brush size
-   Ctrl + Z - Undo
-   Ctrl + Y - Redo
-   T - Toggle between overlay and whiteboard mode
-   F - Focus page content without hiding drawing
-   F1 - Hide drawing and focus page content
-   Ctrl + S - Save drawing as image

Colors:

-   C - Open color picker
-   W - White
-   B - Black
-   R - Red
-   G - Green
-   L - Blue
-   Y - Yellow
-   O - Orange
-   P - Purple
-   M - Magenta
-   A - Aqua

A video overview of all the features is also available [here](https://youtu.be/p6k4BcRgB7k).
