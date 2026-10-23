#!/bin/sh
# helpers dentro do container guitarr-emu
case "$1" in
 reinstall) adb install -r /dist/$2 >/dev/null && adb shell pm grant app.guitarr android.permission.POST_NOTIFICATIONS; adb shell am force-stop app.guitarr; adb shell am start -n app.guitarr/.MainActivity >/dev/null; sleep 8
   adb forward --remove-all >/dev/null 2>&1; S=$(adb shell cat /proc/net/unix | grep -o 'webview_devtools_remote_[0-9]*' | head -1); adb forward tcp:9222 localabstract:$S; echo "forward $S";;
 shot) adb exec-out screencap -p > /tmp/$2.png;;
 wait) adb shell dumpsys window | grep -i "anr\|not responding" | head -2;;
esac
