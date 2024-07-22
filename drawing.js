// the entire script is wrapped in a function to prevent variable and function name conflicts
(function () {
    document.sdmcd = !document.sdmcd;

    let size = 5;
    // this var is only used as a "mirror" of brush size and is appropriately scaled during text creation
    let fontSize = 5;
    let color = "#FF0000";
    let drawing = false;
    let erasing = false;
    let unfocused = false;
    let hidden = false;
    let history = [];
    let redoHistory = [];
    let points = [];
    let lastX, lastY;
    let brushOutline;
    let brushOutlineFadeTimeout;
    let popup;
    // 0 = pen/line, 1 = rectangle/square, 2 = ellipse/circle
    let shape = 0;
    let shift = false;
    let shiftTainted = false;

    let whiteboard = false;

    let canvas;
    let ctx;

    if (document.sdmcd) {
        addCSS();

        canvas = document.createElement("canvas");
        canvas.id = "sdmcd-canvas";
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        document.body.appendChild(canvas);

        ctx = canvas.getContext("2d", { willReadFrequently: true });

        ctx.lineWidth = size;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        applyColor();

        addMouseListeners();

        // save listener aborter to document to persist across bookmarklet calls
        document.sdmcdKeyAborter = new AbortController();
        window.addEventListener("keydown", keyDown, { capture: true, signal: document.sdmcdKeyAborter.signal });
        window.addEventListener("keyup", keyUp, { capture: true, signal: document.sdmcdKeyAborter.signal });
    } else {
        removeDrawing();
    }

    function removeDrawing() {
        removeMouseListeners();
        document.sdmcdKeyAborter.abort();
        document.getElementById("sdmcd-canvas")?.remove();
        document.getElementById("sdmcd-popup-bg")?.remove();
        // clear text inputs
        for (const input of document.getElementsByClassName("sdmcd-text-input")) {
            input.remove();
        }
    }

    function contextMenu(e) {
        e.preventDefault();
    }

    function pointerDown(e) {
        // don't draw if popup is open
        if (document.getElementById("sdmcd-popup-bg")) return;

        // ignore in text inputs
        if (e.target.classList.contains("sdmcd-text-input")) return;

        // start drawing if LMB or touch
        if (e.button === 0 || e.button === undefined) {
            // reset size and color from potential previous erasing
            ctx.lineWidth = size;
            ctx.globalCompositeOperation = "source-over";
            applyColor();
            drawing = true;
        }

        // start erasing if RMB
        if (e.button === 2) {
            // erase with larger brush
            ctx.lineWidth = Math.max(size * 1.5, 30);
            // erase based on whether canvas is whiteboard or not
            if (whiteboard) {
                ctx.fillStyle = "#FFFFFF";
                ctx.strokeStyle = "#FFFFFF";
                ctx.globalCompositeOperation = "source-over";
            } else {
                ctx.globalCompositeOperation = "destination-out";
            }
            erasing = true;
            displayBrushOutline();
        }

        // text input if middle click
        if (e.button === 1) {
            textInput(e.clientX, e.clientY);
            e.preventDefault();
        } else {
            // save snapshot of current canvas to history
            history.push({ data: ctx.getImageData(0, 0, canvas.width, canvas.height) });
        }

        // clear redo history
        redoHistory = [];

        points.push({ x: e.clientX, y: e.clientY });
    }

    function pointerUp(e) {
        // paint bucket if shift click
        if (drawing && shift && points.length === 1) {
            paintBucket(e.clientX, e.clientY);
        } else {
            pointerMove(e);
        }

        // don't check for button release as weird button combinations can cause only LMB down and RMB up events to fire (or vice versa)
        if (drawing) {
            drawing = false;
        }
        if (erasing) {
            erasing = false;
            // fade out
            brushOutline.classList.add("sdmcd-fading");
        }
        points = [];
    }

    function pointerMove(e) {
        // move brush outline to mouse position
        if (brushOutline) {
            // make brush larger if erasing
            let outlineSize = size;
            if (brushOutline.classList.contains("sdmcd-erasing")) {
                outlineSize = Math.max(size * 1.5, 30);
            }

            brushOutline.style.top = e.clientY - outlineSize / 2 - 1 + "px";
            brushOutline.style.left = e.clientX - outlineSize / 2 - 1 + "px";
        }

        // save mouse position for brush outline
        lastX = e.clientX;
        lastY = e.clientY;

        if (!drawing && !erasing) return;

        // don't consider a shift press overlapping with drawing as a shape switch since it can be circle/square
        shiftTainted = true;

        points.push({ x: e.clientX, y: e.clientY });

        render();
    }

    function render() {
        if (drawing) {
            if (shape === 0 && !shift) {
                drawPen();
            } else if (shape === 0 && shift) {
                drawLine();
            } else if (shape === 1 && !shift) {
                drawRectangle();
            } else if (shape === 1 && shift) {
                drawSquare();
            } else if (shape === 2 && !shift) {
                drawEllipse();
            } else if (shape === 2 && shift) {
                drawCircle();
            }
        } else if (erasing) {
            erase();
        }
    }

    function scroll(e) {
        e.preventDefault();

        // change font size with scroll if in text input
        if (document.activeElement.classList.contains("sdmcd-text-input")) {
            if (e.deltaY > 0) {
                fontSize -= 1;
            } else {
                fontSize += 1;
            }
            if (fontSize < 1) {
                fontSize = 1;
            }
            document.activeElement.style.fontSize = 2.5 * fontSize + 20 + "px";
            return;
        }

        if (!e.shiftKey) return;

        // void if popup open
        if (popup && document.body.contains(popup)) return;

        // increase/decrease brush size with scroll wheel
        if (e.deltaY > 0) {
            size -= 1;
        } else {
            size += 1;
        }
        if (size < 1) {
            size = 1;
        }
        ctx.lineWidth = size;
        fontSize = size;
        displayBrushOutline();
        render();
    }

    // https://web.archive.org/web/20180216002849/http://www.williammalone.com/articles/html5-canvas-javascript-paint-bucket-tool/
    function paintBucket(startX, startY) {
        // reset to last snapshot to get the correct start color
        const previous = history[history.length - 1];
        ctx.putImageData(previous.data, 0, 0);

        const pixelStack = [[startX, startY]];
        const colorLayer = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const startColor = getPixelColor(startX, startY);
        const fillColor = hexToRgb(color);

        // check if the color is already the fill color
        if (startColor.r === fillColor.r && startColor.g === fillColor.g && startColor.b === fillColor.b) return;

        while (pixelStack.length) {
            const [x, y] = pixelStack.pop();
            let pixelPos = (y * canvas.width + x) * 4;

            let y1 = y;
            while (y1 >= 0 && matchStartColor(pixelPos)) {
                y1--;
                pixelPos -= canvas.width * 4;
            }

            pixelPos += canvas.width * 4;
            y1++;

            let reachLeft = false;
            let reachRight = false;

            while (y1 < canvas.height && matchStartColor(pixelPos)) {
                colorPixel(pixelPos);

                if (x > 0) {
                    if (matchStartColor(pixelPos - 4)) {
                        if (!reachLeft) {
                            pixelStack.push([x - 1, y1]);
                            reachLeft = true;
                        }
                    } else if (reachLeft) {
                        reachLeft = false;
                    }
                }

                if (x < canvas.width - 1) {
                    if (matchStartColor(pixelPos + 4)) {
                        if (!reachRight) {
                            pixelStack.push([x + 1, y1]);
                            reachRight = true;
                        }
                    } else if (reachRight) {
                        reachRight = false;
                    }
                }

                y1++;
                pixelPos += canvas.width * 4;
            }
        }

        ctx.putImageData(colorLayer, 0, 0);

        function getPixelColor(x, y) {
            const pixelPos = (y * canvas.width + x) * 4;
            return {
                r: colorLayer.data[pixelPos],
                g: colorLayer.data[pixelPos + 1],
                b: colorLayer.data[pixelPos + 2],
                a: colorLayer.data[pixelPos + 3],
            };
        }

        function hexToRgb(hex) {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return { r, g, b, a: 255 };
        }

        function matchStartColor(pixelPos) {
            const r = colorLayer.data[pixelPos];
            const g = colorLayer.data[pixelPos + 1];
            const b = colorLayer.data[pixelPos + 2];
            const a = colorLayer.data[pixelPos + 3];

            // fill all semi-transparent pixels otherwise we leave an ugly outline
            if (a > 0 && a < 255) return true;

            // exact color match
            if (r === startColor.r && g === startColor.g && b === startColor.b) return true;

            // if the pixel color is a uniform blend between the start and fill color, fill it too
            /* this is kind of a hack and only works when filling with the color of the outline,
            otherwise it still leaves the outline, but since that's the main use of filling it's fine */
            const diffR = Math.abs(startColor.r - fillColor.r) / Math.abs(r - startColor.r);
            const diffG = Math.abs(startColor.g - fillColor.g) / Math.abs(g - startColor.g);
            const diffB = Math.abs(startColor.b - fillColor.b) / Math.abs(b - startColor.b);

            const toCompare = [];
            if (!isNaN(diffR)) toCompare.push(diffR);
            if (!isNaN(diffG)) toCompare.push(diffG);
            if (!isNaN(diffB)) toCompare.push(diffB);

            // check if all the relative differences are the same
            return toCompare.length > 0 && toCompare.every((val, i, arr) => val === arr[0]) && toCompare[0] != 1;
        }

        function colorPixel(pixelPos) {
            colorLayer.data[pixelPos] = fillColor.r;
            colorLayer.data[pixelPos + 1] = fillColor.g;
            colorLayer.data[pixelPos + 2] = fillColor.b;
            colorLayer.data[pixelPos + 3] = fillColor.a;
        }
    }

    function textInput(x, y) {
        const input = document.createElement("div");
        input.contentEditable = true;
        input.type = "text";
        input.classList.add("sdmcd-text-input");
        input.style.color = color;
        input.style.fontSize = 2.5 * fontSize + 20 + "px";
        input.style.top = y - 1.5 * fontSize - 15 + "px";
        input.style.left = x + "px";
        // uniquely identify text input
        input.id = "sdmcd-text-input-" + Date.now();
        document.body.appendChild(input);
        input.focus();

        // take a snapshot every time text is focused
        input.addEventListener("focus", () => {
            history.push({ textId: input.id, text: input.textContent });
            redoHistory = [];
        });

        // remove on right click
        input.addEventListener("pointerdown", (e) => {
            if (e.button === 2) {
                e.preventDefault();
                input.classList.toggle("removed");
                history.push({ textId: input.id });
                redoHistory = [];
            }
        });

        history.push({ textId: input.id });
    }

    function revertState() {
        // revert to previous state to draw new line
        const previous = history[history.length - 1].data;
        ctx.putImageData(previous, 0, 0);
    }

    function drawPen() {
        revertState();

        // https://stackoverflow.com/a/10568043/19271522

        // draw a single point
        if (points.length < 4) {
            var b = points[0];
            ctx.beginPath();
            ctx.arc(b.x, b.y, ctx.lineWidth / 2, 0, Math.PI * 2, !0);
            ctx.closePath();
            ctx.fill();
        } else {
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            // draw a bunch of quadratics, using the average of two points as the control point
            for (i = 1; i < points.length - 2; i++) {
                const midX = (points[i].x + points[i + 1].x) / 2;
                const midY = (points[i].y + points[i + 1].y) / 2;
                ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
            }
            ctx.quadraticCurveTo(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);
            ctx.stroke();
        }
    }

    function drawLine() {
        revertState();

        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
        ctx.stroke();
    }

    function drawRectangle() {
        revertState();

        const x = Math.min(points[0].x, points[points.length - 1].x);
        const y = Math.min(points[0].y, points[points.length - 1].y);
        const width = Math.abs(points[0].x - points[points.length - 1].x);
        const height = Math.abs(points[0].y - points[points.length - 1].y);

        ctx.strokeRect(x, y, width, height);
    }

    function drawSquare() {
        revertState();

        const x = points[0].x;
        const y = points[0].y;
        // side length as average of x and y distance
        const side = (Math.abs(points[0].x - points[points.length - 1].x) + Math.abs(points[0].y - points[points.length - 1].y)) / 2;
        const width = points[0].x < points[points.length - 1].x ? side : -side;
        const height = points[0].y < points[points.length - 1].y ? side : -side;

        ctx.strokeRect(x, y, width, height);
    }

    function drawEllipse() {
        revertState();

        const x = Math.min(points[0].x, points[points.length - 1].x);
        const y = Math.min(points[0].y, points[points.length - 1].y);
        const width = Math.abs(points[0].x - points[points.length - 1].x);
        const height = Math.abs(points[0].y - points[points.length - 1].y);

        ctx.beginPath();
        ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
    }

    function drawCircle() {
        revertState();

        const x = points[0].x;
        const y = points[0].y;
        const radius =
            Math.min(Math.abs(points[0].x - points[points.length - 1].x), Math.abs(points[0].y - points[points.length - 1].y)) / 2;
        const width = points[0].x < points[points.length - 1].x ? radius : -radius;
        const height = points[0].y < points[points.length - 1].y ? radius : -radius;

        ctx.beginPath();
        ctx.ellipse(x + width, y + height, radius, radius, 0, 0, Math.PI * 2);
        ctx.stroke();
    }

    function erase() {
        // this isn't a perfect algo but it means that we don't redraw the entire canvas every time
        // and for erasing it's definitely good enough
        if (points.length < 4) {
            var b = points[0];
            ctx.beginPath();
            ctx.arc(b.x, b.y, ctx.lineWidth / 2, 0, Math.PI * 2, !0);
            ctx.closePath();
            ctx.fill();
            return;
        }
        const point1 = points[points.length - 4];
        const point2 = points[points.length - 2];
        const point3 = points[points.length - 1];
        ctx.beginPath();
        ctx.moveTo(point1.x, point1.y);
        ctx.quadraticCurveTo(point3.x, point3.y, point2.x, point2.y);
        ctx.stroke();
    }

    function dragStart(e) {
        e.preventDefault();
    }

    function keyDown(e) {
        let popup;
        let captured = true;

        if (e.key === "Escape" && document.activeElement.classList.contains("sdmcd-text-input")) {
            document.activeElement.blur();
            return;
        }

        // ignore key presses in text inputs
        // except ctrl shortcuts
        if (document.activeElement.classList.contains("sdmcd-text-input") && !e.ctrlKey) return;

        // ignore key presses when unfocused/hidden
        // except F1 while unfocused/hidden and F while unfocused
        if (!(!(unfocused || hidden) || (e.key == "F1" && (unfocused || hidden)) || (e.key == "f" && unfocused))) return;

        // keep track of if any key has been pressed while shift is held because a clean
        // shift keypress is used to switch to pen
        if (shift) {
            shiftTainted = true;
        }

        if (e.key === "Shift" && !shift) {
            shift = true;
            shiftTainted = false;
        }

        switch (e.key) {
            case "Escape":
                // close popup if open
                if (document.getElementById("sdmcd-popup-bg")) {
                    document.getElementById("sdmcd-popup-bg").remove();
                } else {
                    // otherwise exit drawing mode
                    document.sdmcd = false;
                    removeDrawing();
                }
                break;
            case "e":
                // save snapshot of current canvas to history
                history.push({ data: ctx.getImageData(0, 0, canvas.width, canvas.height) });
                // erase canvas
                if (whiteboard) {
                    ctx.fillStyle = "#FFFFFF";
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    applyColor();
                } else {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                }
                // clear redo history
                redoHistory = [];
                break;
            case "s":
                // save image
                if (e.ctrlKey) {
                    const dataURL = canvas.toDataURL("image/png");
                    const a = document.createElement("a");
                    a.href = dataURL;
                    a.download = "drawing.png";
                    a.click();
                } else {
                    // reset stroke width
                    size = 5;
                    fontSize = 5;
                    ctx.lineWidth = 5;
                    displayBrushOutline();
                }
                break;
            case "w":
                color = "#FFFFFF";
                break;
            case "b":
                color = "#000000";
                break;
            case "r":
                color = "#FF0000";
                break;
            case "g":
                color = "#00FF00";
                break;
            case "l":
                color = "#0000FF";
                break;
            case "o":
                color = "#FFA500";
                break;
            case "p":
                color = "#800080";
                render();
                break;
            case "m":
                color = "#FF00FF";
                break;
            case "a":
                color = "#00FFFF";
                break;
            case "c":
                // don't open popup if drawing
                if (drawing || erasing) break;
                popup = document.getElementById("sdmcd-popup-bg");
                if (popup) {
                    popup.remove();
                } else {
                    showColorPopup();
                }
                break;
            case "ArrowUp":
                size += 1;
                ctx.lineWidth = size;
                fontSize = size;
                displayBrushOutline();
                break;
            case "ArrowDown":
                size -= 1;
                if (size < 1) {
                    size = 1;
                }
                ctx.lineWidth = size;
                fontSize = size;
                displayBrushOutline();
                break;
            case "f":
                unfocused = !unfocused;
                applyUnfocus();
                break;
            case "F1":
                hidden = !hidden;
                applyHide();
                break;
            case "z":
                if (e.ctrlKey) {
                    const current = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const previous = history.pop();
                    if (!previous) break;
                    // if previous was a mode switch, switch back and add switch to redo history
                    if (previous.switch) {
                        switchMode(false);
                    }

                    if (previous.data) ctx.putImageData(previous.data, 0, 0);

                    if (previous.activeTextInputs) {
                        // restore whiteboard texts
                        for (const inputId of previous.activeTextInputs) {
                            const input = document.getElementById(inputId);
                            input.classList.remove("removed");
                        }
                        redoHistory.push({ data: current, activeTextInputs: previous.activeTextInputs, switch: previous.switch });
                    } else if (previous.textId) {
                        document.activeElement.blur();
                        const input = document.getElementById(previous.textId);
                        if (previous.text) {
                            // previous action was a text edit
                            redoHistory.push({ data: current, textId: previous.textId, text: input.textContent });
                            input.textContent = previous.text;
                        } else {
                            // previous action was a text input (init)
                            redoHistory.push({ data: current, textId: previous.textId });
                            input.classList.toggle("removed");
                        }
                    } else {
                        // save current canvas to redo history
                        redoHistory.push({ data: current, switch: previous.switch });
                    }
                }
                break;
            case "y":
                if (e.ctrlKey) {
                    const current = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const next = redoHistory.pop();
                    if (!next) break;
                    // if previous was a mode switch, switch back and add switch to redo history
                    if (next.switch) {
                        switchMode(false);
                    }
                    if (next.data) ctx.putImageData(next.data, 0, 0);

                    if (next.activeTextInputs) {
                        // restore whiteboard texts
                        for (const inputId of next.activeTextInputs) {
                            const input = document.getElementById(inputId);
                            input.classList.add("removed");
                        }
                        history.push({ data: current, activeTextInputs: next.activeTextInputs, switch: next.switch });
                    } else if (next.textId) {
                        document.activeElement.blur();
                        const input = document.getElementById(next.textId);
                        if (next.text) {
                            // previous action was a text edit
                            history.push({ data: current, textId: next.textId, text: input.textContent });
                            input.textContent = next.text;
                        } else {
                            // previous action was a text input (init)
                            history.push({ data: current, textId: next.textId });
                            input.classList.toggle("removed");
                        }
                    } else {
                        // save current canvas to redo history
                        history.push({ data: current, switch: next.switch });
                    }
                } else {
                    color = "#FFFF00";
                    break;
                }
                break;
            case "t":
                switchMode(true);
                break;
            case "R":
                shape = 1;
                break;
            case "C":
                shape = 2;
                break;
            case "h":
                // don't open popup if drawing
                if (drawing || erasing) break;
                popup = document.getElementById("sdmcd-popup-bg");
                if (popup) {
                    popup.remove();
                } else {
                    showHelpPopup();
                }
                break;
            default:
                captured = false;
        }
        applyColor();
        render();
        if (captured) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    function keyUp(e) {
        if (e.key === "Shift") {
            if (!shiftTainted) {
                shape = 0;
            }
            shift = false;
            render();
        }
    }

    function applyUnfocus() {
        if (unfocused) {
            hidden = false;
            document.body.classList.add("sdmcd-unfocused");
            removeMouseListeners();
        } else {
            document.body.classList.remove("sdmcd-unfocused");
            addMouseListeners();
        }
    }

    function applyHide() {
        if (hidden) {
            unfocused = false;
            document.body.classList.add("sdmcd-hidden");
            document.body.classList.remove("sdmcd-unfocused");
            removeMouseListeners();
        } else {
            document.body.classList.remove("sdmcd-hidden");
            addMouseListeners();
        }
    }

    function applyColor() {
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
    }

    function switchMode(saveSnapshot) {
        whiteboard = !whiteboard;
        ctx.globalCompositeOperation = "source-over";
        /* grab all the active text inputs and save their ids so they can be restored
           with undo */
        const activeTextElms = document.querySelectorAll(".sdmcd-text-input:not(.removed)");
        const texts = [...activeTextElms].map((input) => input.id);
        activeTextElms.forEach((input) => input.classList.add("removed"));
        if (whiteboard) {
            // save snapshot of current canvas to history (with mode switch)
            if (saveSnapshot) {
                history.push({ switch: true, activeTextInputs: texts, data: ctx.getImageData(0, 0, canvas.width, canvas.height) });
            }
            ctx.fillStyle = "#FFFFFF";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            color = "#000000";
            applyColor();
        } else {
            if (saveSnapshot) {
                history.push({ switch: true, activeTextInputs: texts, data: ctx.getImageData(0, 0, canvas.width, canvas.height) });
            }
            color = "#FF0000";
            applyColor();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        redoHistory = [];
    }

    function addMouseListeners() {
        // save listener aborter to document to persist across bookmarklet calls
        document.sdmcdMouseAborter = new AbortController();

        window.addEventListener("contextmenu", contextMenu, { signal: document.sdmcdMouseAborter.signal });
        window.addEventListener("pointerdown", pointerDown, { signal: document.sdmcdMouseAborter.signal });
        window.addEventListener("pointerup", pointerUp, { signal: document.sdmcdMouseAborter.signal });
        window.addEventListener("pointermove", pointerMove, { signal: document.sdmcdMouseAborter.signal });
        window.addEventListener("dragstart", dragStart, { signal: document.sdmcdMouseAborter.signal });
        window.addEventListener("wheel", scroll, { passive: false, signal: document.sdmcdMouseAborter.signal });
        document.body.style.touchAction = "none";
    }

    function removeMouseListeners() {
        document.sdmcdMouseAborter.abort();
        document.body.style.touchAction = "auto";
    }

    function displayBrushOutline() {
        if (!brushOutline) {
            brushOutline = document.createElement("div");
            brushOutline.id = "sdmcd-brush-outline";
            document.body.appendChild(brushOutline);
        }

        // reveal immediately
        brushOutline.classList.remove("sdmcd-fading");

        // clear erasing class if not erasing anymore
        if (!erasing) {
            brushOutline.classList.remove("sdmcd-erasing");
        }

        // cancel fade
        clearTimeout(brushOutlineFadeTimeout);

        // make brush larger if erasing and add class for use in pointermove
        let outlineSize = size;
        if (erasing) {
            outlineSize = Math.max(size * 1.5, 30);
            brushOutline.classList.add("sdmcd-erasing");
        }

        brushOutline.style.top = lastY - outlineSize / 2 - 1 + "px";
        brushOutline.style.left = lastX - outlineSize / 2 - 1 + "px";
        brushOutline.style.width = outlineSize + "px";
        brushOutline.style.height = outlineSize + "px";

        if (!erasing) {
            brushOutlineFadeTimeout = setTimeout(() => {
                // fade out after 0.5 seconds
                brushOutline.classList.add("sdmcd-fading");
            }, 500);
        }
    }

    function showColorPopup() {
        const popupContent = createPopup();

        const colorContent = document.createElement("div");
        colorContent.id = "sdmcd-color-content";
        popupContent.appendChild(colorContent);

        const colorPicker = document.createElement("input");
        colorPicker.id = "sdmcd-color";
        colorPicker.type = "color";
        colorPicker.value = color;
        colorPicker.addEventListener("change", (e) => {
            color = e.target.value;
            applyColor();
        });

        colorContent.textContent = "Color:";
        colorContent.appendChild(colorPicker);
    }

    function showHelpPopup() {
        const popupContent = createPopup();

        const helpBg = document.createElement("div");
        helpBg.id = "sdmcd-help-bg";
        popupContent.appendChild(helpBg);

        const left = document.createElement("div");
        left.id = "sdmcd-help-left";
        left.innerHTML = `<h3>General</h3>`;
        helpBg.appendChild(left);

        const right = document.createElement("div");
        right.id = "sdmcd-help-right";
        right.innerHTML = `<h3>Colors</h3>`;
        helpBg.appendChild(right);

        const helpLines = [
            [1, "Left Click", "Draw"],
            [1, "Right Click", "Erase"],
            [1, "Middle Click", "Add text"],
            [1],
            [1, "Shift", "Switch to freehand"],
            [1, "Shift + R", "Switch to rectangle"],
            [1, "Shift + C", "Switch to circle"],
            [1, "Shift + Click", "Fill color"],
            [1],
            [1, "E", "Erase canvas"],
            [1, "T", "Toggle whiteboard mode"],
            [1, "Shift + Scroll", "Change brush size"],
            [1],
            [1, "F", "Focus page content"],
            [1, "F1", "Hide drawing"],
            [1],
            [1, "Ctrl + Z", "Undo"],
            [1, "Ctrl + Y", "Redo"],
            [1, "Ctrl + S", "Save as image"],
            [1],
            [1, "H", "Show keybinds"],
            [1, "Esc", "Close modal / Exit drawing"],
            [2, "W", "White"],
            [2, "B", "Black"],
            [2, "R", "Red"],
            [2, "G", "Green"],
            [2, "L", "Blue"],
            [2, "Y", "Yellow"],
            [2, "O", "Orange"],
            [2, "P", "Purple"],
            [2, "M", "Magenta"],
            [2, "A", "Aqua"],
            [2],
            [2, "C", "Custom color"],
        ];

        helpLines.forEach(([column, key, value]) => {
            const div = document.createElement("div");
            div.classList.add("sdmcd-help-line");
            if (key && value) {
                key = key
                    .split(" + ")
                    .map((k) => `<code>${k}</code>`)
                    .join(" + ");
                div.innerHTML = `<span>${key}</span><span>${value}</span>`;
            }
            if (column === 1) {
                left.appendChild(div);
            } else {
                right.appendChild(div);
            }
        });
    }

    function createPopup() {
        const popupBg = document.createElement("div");
        popupBg.id = "sdmcd-popup-bg";
        popupBg.addEventListener("click", (e) => {
            if (e.target == popupBg) popupBg.remove();
        });

        const popupContent = document.createElement("div");
        popupContent.id = "sdmcd-popup-content";

        popupBg.appendChild(popupContent);
        document.body.appendChild(popupBg);

        popup = popupBg;
        return popupContent;
    }

    function addCSS() {
        if (document.getElementById("sdmcd-css")) return;

        const style = document.createElement("style");
        style.id = "sdmcd-css";
        style.innerHTML =
            "#sdmcd-canvas{position:fixed;top:0;left:0;z-index:9999997;cursor:crosshair}.sdmcd-hidden #sdmcd-canvas,.sdmcd-hidden .sdmcd-text-input,.sdmcd-text-input.removed{display:none}.sdmcd-unfocused #sdmcd-canvas,.sdmcd-unfocused .sdmcd-text-input{pointer-events:none}#sdmcd-popup-bg{position:fixed;top:0;left:0;z-index:9999999;width:100vw;height:100vh;background-color:rgba(0,0,0,.8);display:flex;justify-content:center;align-items:center;font-size:1vw;color:#fff;font-family:Helvetica,sans-serif}#sdmcd-popup-content{display:flex;flex-direction:column;justify-content:center;align-items:center;pointer-events:none}#sdmcd-help-bg{display:flex;width:45em;background-color:#2b2b2e;color:#fff;font-family:Arial,sans-serif;font-size:min(1.25em, 2vw, 2vh);padding:1em 2.5em;gap:3em;pointer-events:all;border-radius:.5em}#sdmcd-help-left,#sdmcd-help-right{flex:1;padding:1em}#sdmcd-help-bg #sdmcd-help-left{flex:1.7}#sdmcd-help-bg h3{font-size:1.3em;margin-bottom:.8em}.sdmcd-help-line{display:flex;justify-content:space-between;height:1.5em;border-bottom:1px solid #ffffff22;margin:.2em 0}.sdmcd-help-line code{background-color:#222124;padding:.1em .3em;border-radius:.2em;text-transform:uppercase}#sdmcd-color-content{font-size:2em;display:flex;flex-direction:column;align-items:center;gap:.2em}#sdmcd-color{width:20em;height:20em;border-radius:1em;padding:0;border:none;outline:0;cursor:pointer;pointer-events:auto}#sdmcd-color::-webkit-color-swatch-wrapper{padding:0}#sdmcd-color::-webkit-color-swatch{border:none;border-radius:.5em}#sdmcd-brush-outline{position:fixed;border-radius:50%;border:1px solid #888;pointer-events:none;z-index:9999998}#sdmcd-brush-outline.sdmcd-fading{opacity:0;transition:opacity .5s}.sdmcd-text-input{position:fixed;z-index:9999998;outline:0;border-right:1px solid transparent;font-family:Arial,Helvetica,sans-serif;font-weight:400}";
        document.head.appendChild(style);
    }
})();
