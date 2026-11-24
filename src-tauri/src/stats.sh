# A machine's health: uptime, CPU, memory and disks, as key=value lines.
# Linux or macOS. Run by machine_stats (lib.rs); parsed by src/lib/stats.js.
os=$(uname -s)
if [ "$os" = Linux ]; then
  echo "uptime=$(cut -d' ' -f1 /proc/uptime)"
  echo "ncpu=$(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo)"
  echo "load=$(cut -d' ' -f1-3 /proc/loadavg)"
  s1=$(head -1 /proc/stat); sleep 0.5; s2=$(head -1 /proc/stat)
  echo "$s1
$s2" | awk '{ idle = $5 + $6; total = 0; for (i = 2; i <= NF; i++) total += $i; t[NR] = total; d[NR] = idle }
    END { dt = t[2] - t[1]; if (dt > 0) printf "cpu=%.1f\n", 100 * (dt - (d[2] - d[1])) / dt }'
  awk '/^MemTotal:/ { t = $2 } /^MemAvailable:/ { a = $2 } END { printf "mem_total=%d\nmem_used=%d\n", t, t - a }' /proc/meminfo
  # Every real local disk bigger than 4 GB, whatever it's mounted as.
  df -Pk -l -x tmpfs -x devtmpfs -x overlay -x squashfs -x efivarfs 2>/dev/null |
    awk 'NR > 1 && $2 > 4194304 && !seen[$6]++ { print "disk=" $6 "|" $2 "|" $3 }'
  roots=""
else
  boot=$(sysctl -n kern.boottime | sed 's/^{ sec = \([0-9]*\).*/\1/')
  echo "uptime=$(( $(date +%s) - boot ))"
  n=$(sysctl -n hw.ncpu); echo "ncpu=$n"
  echo "load=$(sysctl -n vm.loadavg | tr -d '{}' | awk '{print $1, $2, $3}')"
  ps -A -o %cpu= | awk -v n="$n" '{ s += $1 } END { v = s / n; if (v > 100) v = 100; printf "cpu=%.1f\n", v }'
  page=$(sysctl -n hw.pagesize); total=$(sysctl -n hw.memsize)
  vm_stat | awk -v p="$page" -v t="$total" '
    /Pages active/ { a = $NF } /Pages wired/ { w = $NF } /occupied by compressor/ { c = $NF }
    END { gsub("\\.", "", a); gsub("\\.", "", w); gsub("\\.", "", c); printf "mem_total=%d\nmem_used=%d\n", t / 1024, (a + w + c) * p / 1024 }'
  roots="/System/Volumes/Data"
fi
seen=""
for r in $roots; do
  [ -d "$r" ] || continue
  df -Pk "$r" 2>/dev/null | awk 'NR == 2 { print $6 "|" $2 "|" $3 }' | while IFS='|' read -r mnt size used; do
    echo "disk=$mnt|$size|$used"
  done
done | awk '!seen[$0]++'
