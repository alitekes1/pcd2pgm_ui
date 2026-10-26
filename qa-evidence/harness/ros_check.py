"""Nav2 map_server world-coordinate check and reference pcd2pgm comparison.

usage: ros_check.py nav2 <map.yaml> <x> <y> [<x> <y> ...]    -> prints occupancy at world points
       ros_check.py grab <topic> <out.npz>                     -> saves one OccupancyGrid
"""
import sys, time
import numpy as np
import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, DurabilityPolicy, ReliabilityPolicy
from nav_msgs.msg import OccupancyGrid


def grab(topic, timeout=30.0):
    rclpy.init()
    node = Node("qa_grab")
    qos = QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL, reliability=ReliabilityPolicy.RELIABLE)
    box = {}
    node.create_subscription(OccupancyGrid, topic, lambda m: box.setdefault("m", m), qos)
    end = time.time() + timeout
    while "m" not in box and time.time() < end:
        rclpy.spin_once(node, timeout_sec=0.2)
    node.destroy_node()
    rclpy.shutdown()
    if "m" not in box:
        raise SystemExit(f"no message on {topic}")
    m = box["m"]
    data = np.array(m.data, dtype=np.int16).reshape(m.info.height, m.info.width)  # row 0 = lowest y
    return m.info, data


if sys.argv[1] == "grab":
    info, data = grab(sys.argv[2])
    np.savez(sys.argv[3], data=data, res=info.resolution, ox=info.origin.position.x, oy=info.origin.position.y, w=info.width, h=info.height)
    print(f"grabbed {info.width}x{info.height} res={info.resolution:.4f} origin=({info.origin.position.x:.6f},{info.origin.position.y:.6f}) occupied={(data == 100).sum()} free={(data == 0).sum()} unknown={(data == -1).sum()}")
elif sys.argv[1] == "nav2":
    info, data = grab("/map")
    pts = list(map(float, sys.argv[2:]))
    out = []
    for x, y in zip(pts[::2], pts[1::2]):
        i = int(np.floor((x - info.origin.position.x) / info.resolution))
        j = int(np.floor((y - info.origin.position.y) / info.resolution))
        v = int(data[j, i]) if 0 <= i < info.width and 0 <= j < info.height else None
        out.append(f"({x},{y})->cell({i},{j})={v}")
    print(f"map {info.width}x{info.height} origin=({info.origin.position.x:.4f},{info.origin.position.y:.4f}) :: " + " ".join(out))
