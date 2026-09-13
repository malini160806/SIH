# FOGNET: AI-Based Cooperative Perception & Haulage Safety Network
## Hackathon Pitch & Demonstration Guide

This document contains a comprehensive guide on how to pitch the FOGNET project to hackathon judges, along with a step-by-step demonstration script designed to showcase the platform's most impressive features.

---

## 1. The Pitch (3-4 Minutes)

### The Problem (The "Hook")
*   **Safety Critical:** In open-cast mining, heavy haul trucks operate in highly congested loops. During winter or adverse weather, fog can reduce visibility to near zero.
*   **The Cost of Fog:** When visibility drops, mines either risk fatal collisions or completely halt operations. Halting operations costs millions of dollars per hour in lost productivity.
*   **The Limitation of Current Tech:** Single-vehicle sensors (like a standalone camera or radar) fail in heavy fog or around blind corners. A truck cannot see what its sensors cannot penetrate.

### The Solution (FOGNET)
*   **Cooperative Perception:** FOGNET is an AI-driven, Vehicle-to-Vehicle (V2V) and Infrastructure-to-Vehicle (I2V) cooperative perception system.
*   **Sensor Fusion:** By fusing data from radar, thermal cameras, and GPS across the entire fleet, FOGNET creates a shared "Digital Twin" of the haul road.
*   **Beyond Line-of-Sight:** If Truck A detects an obstacle, FOGNET instantly shares that data with Truck B, even if Truck B is blinded by fog or around a curve.

### Key Value Propositions
1.  **Zero Harm:** Predictive collision warnings (Time-To-Collision) prevent accidents before they happen.
2.  **Continuous Operation:** Safe, dynamic speed recommendations allow mines to keep operating (at safe speeds) during heavy fog, rather than shutting down entirely.
3.  **Actionable Analytics:** Fleet managers get real-time insights to dynamically reroute traffic and avoid bottlenecks.

---

## 2. Platform Documentation & Features

Recent major upgrades to the FOGNET platform include:

*   **Immersive Digital Twin:** 
    *   Replaced basic canvas with a rich, stylized 2D renderer.
    *   **Features:** Terrain grids, mine building silhouettes, signal towers with blinking lights, compass rose, and styled road segments with depth and edge markings.
    *   **Fog Simulation:** Fog is now represented by localized, animated, semi-transparent cloud puffs that drift and breathe over designated fog zones, rather than a global white washout.
    *   **Vehicle Rendering:** Vehicles feature cab shapes, headlights, pulsing status rings, and forward-facing sensor cone arcs.
    *   **V2V Animations:** Data packets (dots) travel along animated dashed lines between communicating vehicles.
*   **Visibility Gauge (Control Room):**
    *   Replaced the basic line chart with a responsive, radial Canvas gauge.
    *   Features an animated needle, current value readout, and a color-coded zone track (Extreme/Heavy/Medium/Light/Clear).
    *   Includes a glowing segmented bar indicator.
*   **Immersive Driver View:**
    *   Features a responsive, semi-circular speed gauge (canvas-based) showing current speed and recommended speed markers.
    *   **V2V Feed:** A live feed displaying only the messages relevant to the selected driver.
    *   **Dynamic UI:** Background gradients shift dramatically from Green (Safe) to pulsing Red (Critical) based on hazard status.
    *   Visibility meter bar with tick marks.
*   **Demo & Control Mechanisms:**
    *   Automated Demo Mode driven by a configurable `demo_steps.json`.
    *   Real-time speed control slider to slow down or speed up the simulation tick rate for the judges.
    *   Export Logs feature with pagination for offline analytics.

---

## 3. The Demonstration Script (The "Wow" Factor)

**Setup:** Have two browser windows open side-by-side or on extended displays.
*   **Window 1:** The Control Room (`http://127.0.0.1:8000`)
*   **Window 2:** The Driver View (`http://127.0.0.1:8000/driver`)

### Step 1: The Overview (Control Room)
*   **Action:** Point to the Digital Twin.
*   **Talk Track:** *"Welcome to the FOGNET Control Centre. Here, the dispatcher sees a live Digital Twin of the mining haul loop. You can see the trucks moving, their current speeds, and the terrain. Notice the sensor cones projecting from the front of the trucks."*

### Step 2: Introducing Fog & Deterioration
*   **Action:** Click **"Auto-Deteriorate: OFF"** to turn it **ON**, or manually change the fog dropdown to **MEDIUM**.
*   **Talk Track:** *"Watch what happens when weather rolls in. As fog settles over the loading zone, our Visibility Gauge drops.* (Point to the radial gauge). *Notice how the physical sensor cones on the trucks shrink in the digital twin—their physical line-of-sight is severely compromised."*

### Step 3: Cooperative Perception in Action (The V2V Magic)
*   **Action:** Let two trucks approach each other in a fog zone (or trigger the Demo Mode). 
*   **Talk Track:** *"Because their sensors are degraded, Truck A cannot see Truck B purely through its own cameras. However, through our V2V network, they are sharing coordinates and radar data. Look at the blue pulses firing between the trucks—that is real-time cooperative perception."*

### Step 4: The Driver Experience & Safety Intervention
*   **Action:** Switch focus to the **Driver View** window (ensure a vehicle in the fog zone is selected).
*   **Talk Track:** *"This is what the driver sees on their in-cab tablet. As the collision risk increases in the fog, watch the interface."*
*   **Visuals to Highlight:** 
    1.  The background will aggressively shift to Yellow, Orange, or pulsing Red.
    2.  The audio buzzer will beep (if enabled/clicked).
    3.  The Speed Gauge will show their current speed exceeding the dynamic recommended safe speed.
    4.  The V2V feed will show warnings from the truck ahead.

### Step 5: Demo Mode & Analytics
*   **Action:** Click **"▶ DEMO MODE"** in the control room. Use the **Demo Speed Slider** to slow it down.
*   **Talk Track:** *"We have built a scripted demo engine to simulate specific critical edge-cases, like a sudden breakdown in heavy fog. Using the speed slider, we can slow the simulation down to analyze how the AI dynamically calculates the Time-To-Collision (TTC) and issues braking commands before a disaster occurs."*
*   **Action:** Click **"Export Logs"**.
*   **Talk Track:** *"Finally, all of this telemetry is logged. We can export it with a single click for incident analysis or training future AI models."*

---

## 4. Pro-Tips for Judges
*   **Focus on the Animations:** Point out the moving data packets (dots) between trucks. It makes the abstract concept of "V2V communication" highly visual and easy to understand.
*   **The Gauge:** Highlight the custom radial Visibility Gauge—it looks like an industrial dashboard and shows attention to UI/UX detail.
*   **The Driver UI:** Emphasize that the driver UI is deliberately minimal (large fonts, clear colors, audio cues) because a driver in a heavy fog scenario cannot be distracted by complex maps.
