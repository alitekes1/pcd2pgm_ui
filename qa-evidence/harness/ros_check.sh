#!/usr/bin/env bash
# Runs Nav2 map_server and the reference pcd2pgm against app outputs. Each server is its own
# process group in its own ROS domain so nothing leaks between steps.
set +u
source /opt/ros/humble/setup.bash
source /tmp/pcd2pgm-qa/ws/install/setup.bash
Q=/tmp/pcd2pgm-qa
OUT=$Q/out/ros
mkdir -p "$OUT"
export ROS_LOG_DIR=$OUT/log

stop() { kill -TERM -- "-$1" 2>/dev/null; sleep 1; kill -KILL -- "-$1" 2>/dev/null; }

nav2() { # yaml, label, points...
  local yaml=$1 label=$2; shift 2
  export ROS_DOMAIN_ID=91
  setsid ros2 run nav2_map_server map_server --ros-args -r __node:=qa_map -p yaml_filename:="$yaml" >"$OUT/$label-map_server.log" 2>&1 &
  local pid=$!
  sleep 2.5
  timeout 20 ros2 lifecycle set /qa_map configure >/dev/null && timeout 20 ros2 lifecycle set /qa_map activate >/dev/null && echo "[$label] lifecycle ok" || echo "[$label] lifecycle FAILED: $(tail -3 "$OUT/$label-map_server.log")"
  timeout 40 python3 $Q/ros_check.py grab /map "$OUT/$label-nav2.npz" | sed "s/^/[$label nav2] /"
  stop $pid
}

ref() { # pcd, zmin, zmax, label
  export ROS_DOMAIN_ID=92
  setsid ros2 run pcd2pgm pcd2pgm_node --ros-args -p pcd_file:="$1" -p thre_z_min:=$2 -p thre_z_max:=$3 -p thre_radius:=0.1 -p thres_point_count:=10 -p map_resolution:=0.05 -p flag_pass_through:=false >"$OUT/$4-ref.log" 2>&1 &
  local pid=$!
  timeout 120 python3 $Q/ros_check.py grab /map "$OUT/$4-ref.npz" | sed "s/^/[$4 ref] /"
  # map_saver_cli on the same topic, to compare the saved files too
  timeout 60 ros2 run nav2_map_server map_saver_cli -f "$OUT/$4-ref-saved" --ros-args -p map_subscribe_transient_local:=true >"$OUT/$4-saver.log" 2>&1 && echo "[$4 ref] map_saver_cli ok: $(tr '\n' ' ' < "$OUT/$4-ref-saved.yaml")" || echo "[$4 ref] map_saver_cli FAILED: $(tail -2 "$OUT/$4-saver.log")"
  grep -h "After" "$OUT/$4-ref.log" | sed "s/^/[$4 ref] /"
  stop $pid
}

C=$Q/out/chromium
# Origin convention through Nav2: box walls at x 16.5..17.5, y -1.25..-0.25 (room 12.5..22.5 / -7.25..2.75)
nav2 "$C/offset/room_offset_map.yaml" offset 17.0 -1.25 17.0 -0.75 16.5 -0.75 12.5 -7.25 22.5 2.75 20.0 0.0 14.0 -6.0
# Room fixture and real cloud
nav2 "$C/room10/room10_binary_map.yaml" room10 0 5 10 5 5 0 5 10 4.5 6.0 4.5 4.0 5 5
nav2 "$C/real/go2_mid360_new_office_route1_map.yaml" real 0 0
ref $Q/fx/room10_binary.pcd 0.1 1.5 room10
ref /home/tekes/pcd2pgm_ui/go2_mid360_new_office_route1.pcd -0.3 1.1 real
