"""
AR_Measure.py

Simple AR land measurement tool using OpenCV (camera) + optional ArUco auto-calibration.

Features:
- Live camera feed, click to place points (left mouse). Points connect point-to-point and show current polygon area.
- Right-click two points to mark a reference object of known real length (REF_REAL_CM) to compute pixel->cm scale.
- Optionally detect an ArUco marker automatically (set USER_MARKER_SIZE_CM) to compute scale.
- Export: annotated image, points CSV, simple 3D OBJ mesh (extruded polygon with zero height by default).

How to use:
1) Install dependencies:
   pip install opencv-python numpy matplotlib scipy
   (If you want ArUco auto-detection: opencv-contrib-python instead of opencv-python.)

2) Configure at top of this file:
   - CAMERA_ID: 0 (change if you have multiple cameras)
   - REF_REAL_CM: set to real-world length (in cm) of your reference object, or leave None and use ArUco.
   - USER_MARKER_SIZE_CM: set to ArUco marker side length in cm if you want auto-calibration; leave None otherwise.

3) Run: python AR_Measure.py
   - Left-click to add polygon points. Press 'u' to undo last point.
   - Right-click twice to select two points on a reference object (then the script will compute pixel distance between those two and if REF_REAL_CM is set, compute scale).
   - Press 'c' to close polygon / compute final area and export files.
   - Press 'r' to reset points.
   - Press 'q' to quit.

Notes:
- This tool measures area in pixel units and converts to real units using scale (cm per pixel). Accuracy depends on camera perspective. For accurate area measure from a single camera image you need either orthorectified image or to ensure camera is approximately perpendicular to ground and reference is in same plane as measured polygon.
- For farm land measurement, better workflows use stereo, depth sensor, or drone orthophotos. This is a quick approximation.

"""

import cv2
import numpy as np
import math
import csv
import os
from scipy.spatial import Delaunay
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D

# ----------------- USER CONFIG -----------------
CAMERA_ID = 0
WINDOW_NAME = 'AR Measure - click to add points (left)'
OUTPUT_DIR = 'ar_measure_outputs'

# If you have a reference object: set its real-world length in centimeters here.
# Example: set to 100.0 for a 1-meter reference rod placed on the ground.
REF_REAL_CM = None  # <-- EDIT THIS (e.g., 100.0) or leave None to use ArUco marker

# If you want automatic scale via ArUco marker detection, set marker side in cm.
# Requires opencv-contrib-python (cv2.aruco available). Leave None to skip automatic detection.
USER_MARKER_SIZE_CM = None  # <-- EDIT THIS (e.g., 20.0 for a 20cm ArUco marker)
ARUCO_DICT = cv2.aruco.Dictionary_get(cv2.aruco.DICT_4X4_50) if hasattr(cv2.aruco, 'Dictionary_get') else None
ARUCO_PARAMS = cv2.aruco.DetectorParameters_create() if hasattr(cv2.aruco, 'DetectorParameters_create') else None

# initial scale (cm per pixel). Will be computed after reference selection or ArUco detection.
scale_cm_per_pixel = None

# ------------------------------------------------

points = []          # polygon points (x,y)
ref_points = []      # two points used for manual reference -> compute pixel distance

os.makedirs(OUTPUT_DIR, exist_ok=True)

# Utilities

def pixel_distance(a, b):
    return math.hypot(a[0]-b[0], a[1]-b[1])

def polygon_area_px(pts):
    # Shoelace formula
    if len(pts) < 3:
        return 0.0
    x = [p[0] for p in pts]
    y = [p[1] for p in pts]
    x.append(x[0]); y.append(y[0])
    area = 0.0
    for i in range(len(pts)):
        area += x[i]*y[i+1] - x[i+1]*y[i]
    return abs(area)/2.0

# Exports

def save_points_csv(pts, filename):
    with open(filename, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['index','x','y'])
        for i,p in enumerate(pts):
            writer.writerow([i, p[0], p[1]])

def save_obj_extruded(pts, filename, height_cm=0.0):
    # Simple OBJ: top polygon then bottom polygon (extruded by height_cm), connect sides
    # Convert px->cm using scale
    if scale_cm_per_pixel is None:
        print('Scale unknown: cannot export OBJ in real-world units. Exporting pixel units instead.')
    coords = []
    for x,y in pts:
        if scale_cm_per_pixel:
            coords.append((x*scale_cm_per_pixel, y*scale_cm_per_pixel))
        else:
            coords.append((x,y))
    with open(filename,'w') as f:
        f.write('# Simple extruded polygon OBJ\n')
        # vertices top
        for x,y in coords:
            f.write('v {:.6f} {:.6f} {:.6f}\n'.format(x, y, height_cm))
        # vertices bottom
        for x,y in coords:
            f.write('v {:.6f} {:.6f} {:.6f}\n'.format(x, y, 0.0))
        n = len(coords)
        # faces top (note: OBJ is 1-indexed)
        f.write('g top\n')
        f.write('f')
        for i in range(1,n+1):
            f.write(' {}'.format(i))
        f.write('\n')
        # bottom (reverse order)
        f.write('g bottom\n')
        f.write('f')
        for i in range(n,0,-1):
            f.write(' {}'.format(i+n))
        f.write('\n')
        # sides
        f.write('g sides\n')
        for i in range(n):
            a = i+1
            b = ((i+1)%n)+1
            f.write('f {} {} {}'.format(a, b, b+n))
            f.write('f {} {} {}'.format(a, b+n, a+n))

# Mouse callback

def mouse_callback(event, x, y, flags, param):
    global points, ref_points, scale_cm_per_pixel
    if event == cv2.EVENT_LBUTTONDOWN:
        points.append((x,y))
        print(f'Added point: {(x,y)}. Total points: {len(points)}')
    elif event == cv2.EVENT_RBUTTONDOWN:
        # mark reference points (manual)
        ref_points.append((x,y))
        print(f'Ref point: {(x,y)}')
        if len(ref_points) == 2 and REF_REAL_CM is not None:
            px_dist = pixel_distance(ref_points[0], ref_points[1])
            scale_cm_per_pixel = REF_REAL_CM / px_dist
            print(f'[Manual reference] Pixel distance = {px_dist:.2f}px. Scale set: {scale_cm_per_pixel:.6f} cm/px')

# ArUco auto scale

def try_aruco_scale(frame):
    global scale_cm_per_pixel
    if USER_MARKER_SIZE_CM is None:
        return False
    if ARUCO_DICT is None or ARUCO_PARAMS is None:
        return False
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    corners, ids, rejected = cv2.aruco.detectMarkers(gray, ARUCO_DICT, parameters=ARUCO_PARAMS)
    if ids is None or len(ids) == 0:
        return False
    # Use first detected marker
    c = corners[0].reshape((4,2))
    # Average edge length (px)
    e1 = pixel_distance(tuple(c[0]), tuple(c[1]))
    e2 = pixel_distance(tuple(c[1]), tuple(c[2]))
    e3 = pixel_distance(tuple(c[2]), tuple(c[3]))
    e4 = pixel_distance(tuple(c[3]), tuple(c[0]))
    avg_px = (e1+e2+e3+e4)/4.0
    # marker real-world side in cm
    scale_cm_per_pixel = USER_MARKER_SIZE_CM / avg_px
    print(f'[ArUco] detected id={ids[0][0]}. avg_px={avg_px:.2f}. scale={scale_cm_per_pixel:.6f} cm/px')
    return True

# Drawing helper

def draw_overlay(img):
    # copy
    out = img.copy()
    # draw points
    for i,p in enumerate(points):
        cv2.circle(out, (int(p[0]), int(p[1])), 6, (0,255,0), -1)
        cv2.putText(out, str(i+1), (int(p[0])+8, int(p[1])-8), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0,255,0), 1)
    # draw lines
    if len(points) >= 2:
        for i in range(len(points)-1):
            a = tuple(map(int, points[i]))
            b = tuple(map(int, points[i+1]))
            cv2.line(out, a, b, (0,200,255), 2)
    # if polygon closed (3+), draw closing line to first
    if len(points) >= 3:
        cv2.line(out, tuple(map(int,points[-1])), tuple(map(int,points[0])), (0,200,255), 2)
        area_px = polygon_area_px(points)
        text = f'Area: {area_px:.1f} px^2'
        if scale_cm_per_pixel:
            area_cm2 = area_px * (scale_cm_per_pixel**2)
            text += f' = {area_cm2/10000:.3f} m^2'
        cv2.putText(out, text, (10,30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255,255,255), 2)
    # draw reference points if any
    for rp in ref_points:
        cv2.circle(out, (int(rp[0]), int(rp[1])), 5, (255,0,0), -1)
    return out

# Main loop

def main():
    global points, ref_points, scale_cm_per_pixel
    cap = cv2.VideoCapture(CAMERA_ID)
    cv2.namedWindow(WINDOW_NAME)
    cv2.setMouseCallback(WINDOW_NAME, mouse_callback)

    auto_aruco_done = False

    while True:
        ret, frame = cap.read()
        if not ret:
            print('Failed to read from camera. Exiting.')
            break

        # try ArUco detection once to set scale automatically
        if not auto_aruco_done and USER_MARKER_SIZE_CM is not None:
            got = try_aruco_scale(frame)
            if got:
                auto_aruco_done = True

        vis = draw_overlay(frame)
        cv2.imshow(WINDOW_NAME, vis)
        key = cv2.waitKey(10) & 0xFF
        if key == ord('q'):
            break
        elif key == ord('u'):
            if points:
                removed = points.pop()
                print('Removed point:', removed)
        elif key == ord('r'):
            points = []
            ref_points = []
            scale_cm_per_pixel = None if USER_MARKER_SIZE_CM is None else scale_cm_per_pixel
            print('Reset all points and references.')
        elif key == ord('c'):
            # close polygon & export
            if len(points) < 3:
                print('Need at least 3 points to compute area.')
                continue
            area_px = polygon_area_px(points)
            if scale_cm_per_pixel:
                area_cm2 = area_px * (scale_cm_per_pixel**2)
                area_m2 = area_cm2/10000.0
            else:
                area_cm2 = None
                area_m2 = None
            print('Final polygon points:', points)
            print(f'Area: {area_px:.2f} px^2')
            if area_m2 is not None:
                print(f'Area: {area_cm2:.2f} cm^2 = {area_m2:.3f} m^2')
            # save annotated image
            annotated = draw_overlay(frame)
            img_path = os.path.join(OUTPUT_DIR, 'annotated.png')
            cv2.imwrite(img_path, annotated)
            csv_path = os.path.join(OUTPUT_DIR, 'points.csv')
            save_points_csv(points, csv_path)
            obj_path = os.path.join(OUTPUT_DIR, 'polygon.obj')
            save_obj_extruded(points, obj_path, height_cm=0.0)
            print(f'Saved: {img_path}, {csv_path}, {obj_path}')
            # also show a quick 3D preview using matplotlib
            try:
                xs = [p[0] for p in points]
                ys = [p[1] for p in points]
                zs = [0 for _ in points]
                fig = plt.figure()
                ax = fig.add_subplot(111, projection='3d')
                verts = [list(zip(xs, ys, zs))]
                # plot polygon edges
                ax.plot(xs + [xs[0]], ys + [ys[0]], zs + [zs[0]])
                ax.set_title('3D preview (Z=0)')
                ax.set_xlabel('X (px)')
                ax.set_ylabel('Y (px)')
                ax.set_zlabel('Z')
                plt.show()
            except Exception as e:
                print('Could not render 3D preview:', e)

    cap.release()
    cv2.destroyAllWindows()

if __name__ == '__main__':
    main()
