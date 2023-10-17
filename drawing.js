// the entire script is wrapped in a function to prevent variable and function name conflicts
(function () {
    document.sdmcd = !document.sdmcd;

    let size = 5;
    let color = "#FF0000";
    let drawing = false;
    let erasing = false;
    let unfocused = false;
    let history = [];
    let redoHistory = [];
    let points = [];
    let lastX, lastY;
    let brushOutline;
    let brushOutlineFadeTimeout;

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

        // How thick the lines should be
        ctx.lineWidth = size;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        applyColor();

        addMouseListeners();

        // save listener aborter to document to persist across bookmarklet calls
        document.sdmcdKeyAborter = new AbortController();
        window.addEventListener("keydown", keyDown, { capture: true, signal: document.sdmcdKeyAborter.signal });
    } else {
        removeDrawing();
    }

    function removeDrawing() {
        removeMouseListeners();
        document.sdmcdKeyAborter.abort();
        document.getElementById("sdmcd-canvas")?.remove();
        document.getElementById("sdmcd-popup-bg")?.remove();
    }

    function contextMenu(e) {
        e.preventDefault();
    }

    function pointerDown(e) {
        // don't draw if popup is open
        if (document.getElementById("sdmcd-popup-bg")) return;

        // start drawing if LMB or touch (and not erasing)
        if ((e.button === 0 || e.button === undefined) && !erasing) {
            drawing = true;
        }

        // start erasing if RMB (and not drawing)
        if (e.button === 2 && !drawing) {
            erasing = true;
            displayBrushOutline();
        }

        // ignore click if not drawing or erasing
        if (!drawing && !erasing) return;

        // save snapshot of current canvas to history
        history.push({ data: ctx.getImageData(0, 0, canvas.width, canvas.height) });

        // clear redo history
        redoHistory = [];

        points.push({ x: e.clientX, y: e.clientY });
    }

    function pointerUp(e) {
        pointerMove(e);

        if (e.button == 0 || e.button == undefined) {
            drawing = false;
        }
        if (e.button == 2) {
            erasing = false;
            // fade out
            brushOutline.classList.add("sdmcd-fading");
        }
        points = [];
    }

    function pointerMove(e) {
        // move brush outline to mouse position
        if (brushOutline) {
            // match erasing brush size if erasing
            let outlineSize = size;
            if (brushOutline.classList.contains("sdmcd-erasing")) {
                outlineSize = Math.max(size, 30);
            }

            brushOutline.style.top = e.clientY - outlineSize / 2 - 1 + "px";
            brushOutline.style.left = e.clientX - outlineSize / 2 - 1 + "px";
        }

        // save mouse position for brush outline
        lastX = e.clientX;
        lastY = e.clientY;

        if (!drawing && !erasing) return;

        // draw line
        points.push({ x: e.clientX, y: e.clientY });
        drawLine();
    }

    function scroll(e) {
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
        displayBrushOutline();
        e.preventDefault();
    }

    function drawLine() {
        // revert to previous state to draw new line
        const previous = history[history.length - 1].data;
        ctx.putImageData(previous, 0, 0);

        // this is in a temp variable for single point access
        let tempSize = size;

        // erase with larger brush
        if (erasing) {
            tempSize = Math.max(size, 30);
            ctx.lineWidth = tempSize;

            // erase based on whether canvas is whiteboard or not
            if (whiteboard) {
                ctx.globalCompositeOperation = "source-over";
                ctx.fillStyle = "#FFFFFF";
                ctx.strokeStyle = "#FFFFFF";
            } else {
                ctx.globalCompositeOperation = "destination-out";
            }
        }

        // https://stackoverflow.com/a/10568043/19271522

        // draw a single point
        if (points.length < 4) {
            var b = points[0];
            ctx.beginPath();
            ctx.arc(b.x, b.y, tempSize / 2, 0, Math.PI * 2, !0);
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

        // reset settings
        if (erasing) {
            ctx.lineWidth = size;
            ctx.globalCompositeOperation = "source-over";
            applyColor();
        }
    }

    function dragStart(e) {
        e.preventDefault();
    }

    function keyDown(e) {
        let popup;
        let captured = true;
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
                break;
            case "m":
                color = "#FF00FF";
                break;
            case "a":
                color = "#00FFFF";
                break;
            case "c":
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
                displayBrushOutline();
                break;
            case "ArrowDown":
                size -= 1;
                if (size < 1) {
                    size = 1;
                }
                ctx.lineWidth = size;
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
                    ctx.putImageData(previous.data, 0, 0);
                    // save current canvas to redo history
                    redoHistory.push({ data: current, switch: previous.switch });
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
                    ctx.putImageData(next.data, 0, 0);
                    // save current canvas to history
                    history.push({ data: current, switch: next.switch });
                } else {
                    color = "#FFFF00";
                    break;
                }
                break;
            case "t":
                switchMode(true);
                break;
            case "h":
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
        if (captured) {
            e.preventDefault();
        }
    }

    function applyUnfocus() {
        if (unfocused) {
            hidden = false;
            canvas.style.display = "block";
            canvas.style.pointerEvents = "none";
            removeMouseListeners();
        } else {
            canvas.style.pointerEvents = "auto";
            addMouseListeners();
        }
    }

    function applyHide() {
        if (hidden) {
            unfocused = false;
            canvas.style.pointerEvents = "none";
            canvas.style.display = "none";
            removeMouseListeners();
        } else {
            canvas.style.pointerEvents = "auto";
            canvas.style.display = "block";
            addMouseListeners();
        }
    }

    function applyColor() {
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
    }

    function switchMode(saveSnapshot) {
        whiteboard = !whiteboard;
        if (whiteboard) {
            // save snapshot of current canvas to history (with mode switch)
            if (saveSnapshot) {
                history.push({ switch: true, data: ctx.getImageData(0, 0, canvas.width, canvas.height) });
            }
            ctx.fillStyle = "#FFFFFF";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            color = "#000000";
            applyColor();
        } else {
            if (saveSnapshot) {
                history.push({ switch: true, data: ctx.getImageData(0, 0, canvas.width, canvas.height) });
            }
            color = "#FF0000";
            applyColor();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
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

        // match erasing brush size if erasing and add class for use in pointermove
        let outlineSize = size;
        if (erasing) {
            outlineSize = Math.max(size, 30);
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

        const colorPicker = document.createElement("input");
        colorPicker.id = "sdmcd-color";
        colorPicker.type = "color";
        colorPicker.value = color;
        colorPicker.addEventListener("change", (e) => {
            color = e.target.value;
            applyColor();
        });

        popupContent.textContent = "Color:";
        popupContent.appendChild(colorPicker);
    }

    function showHelpPopup() {
        const popupContent = createPopup();

        const leftHelpLines = [
            "General:",
            "E - Erase the canvas",
            "Esc - Close modal / Exit drawing mode",
            "",
            "↑ / Scroll up - Increase brush size",
            "↓ / Scroll down - Decrease brush size",
            "S - Reset brush size",
            "",
            "Ctrl + Z - Undo",
            "Ctrl + Y - Redo",
            "T - Toggle between overlay and whiteboard mode",
            "F - Focus page content without hiding drawing",
            "F1 - Hide drawing and focus page content",
            "Ctrl + S - Save drawing as image",
            "",
            "H - Open this help menu",
        ];

        const rightHelpLines = [
            "Colors:",
            "C - Open color picker",
            "",
            "W - White",
            "B - Black",
            "",
            "R - Red",
            "G - Green",
            "L - Blue",
            "",
            "Y - Yellow",
            "O - Orange",
            "P - Purple",
            "M - Magenta",
            "A - Aqua",
        ];

        const left = document.createElement("div");
        left.classList.add("sdmcd-help-section");
        popupContent.appendChild(left);

        const right = document.createElement("div");
        right.classList.add("sdmcd-help-section");
        popupContent.appendChild(right);

        for (const line of leftHelpLines) {
            const p = document.createElement("p");
            p.textContent = line;
            p.classList.add("sdmcd-help-line");
            left.appendChild(p);
        }

        for (const line of rightHelpLines) {
            const p = document.createElement("p");
            p.textContent = line;
            p.classList.add("sdmcd-help-line");
            right.appendChild(p);
        }

        popupContent.classList.add("sdmcd-horizontal");
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

        return popupContent;
    }

    function addCSS() {
        if (document.getElementById("sdmcd-css")) return;

        const style = document.createElement("style");
        style.id = "sdmcd-css";
        style.innerHTML =
            "#sdmcd-canvas{position:fixed;top:0;left:0;z-index:9999997;cursor:crosshair}#sdmcd-popup-bg{position:fixed;top:0;left:0;z-index:9999999;width:100vw;height:100vh;background-color:rgba(0,0,0,.8);display:flex;justify-content:center;align-items:center;font-size:2rem;color:#fff;font-family:Helvetica,sans-serif}#sdmcd-popup-content{display:flex;flex-direction:column;justify-content:center;align-items:center;pointer-events:none}#sdmcd-popup-content.sdmcd-horizontal{flex-direction:row}.sdmcd-help-section{display:flex;flex-direction:column;justify-content:center;align-items:center;width:35vw}.sdmcd-help-line{font-size:1.5vw;height:1.6em;margin:0}#sdmcd-color{width:10em;height:10em;border-radius:.5em;padding:0;border:none;outline:0;cursor:pointer;pointer-events:auto}#sdmcd-color::-webkit-color-swatch-wrapper{padding:0}#sdmcd-color::-webkit-color-swatch{border:none;border-radius:.5em}#sdmcd-brush-outline{position:fixed;border-radius:50%;border:1px solid #888;pointer-events:none;z-index:9999998}#sdmcd-brush-outline.sdmcd-fading{opacity:0;transition:opacity .5s}";
        document.head.appendChild(style);
    }
})();
