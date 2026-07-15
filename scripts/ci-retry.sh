# CI 用的重試工具：source 後用 `retry <指令>` 執行。
# 指令失敗就重試，最多 3 次重試（＝首次 + 3 = 共 4 次嘗試），間隔遞增以緩解外部網站／網路瞬斷。
# 間隔：首次失敗後等 30s，再失敗等 60s，再失敗等 120s；仍失敗才真正失敗（回傳 1）。
retry() {
  local delays="30 60 120"
  local attempt=1
  until "$@"; do
    local d
    d=$(echo "$delays" | cut -d' ' -f"$attempt")
    if [ -z "$d" ]; then
      echo "::error::「$*」重試後仍失敗（共嘗試 $attempt 次）"
      return 1
    fi
    echo "⚠ 「$*」失敗，${d}s 後重試（即將第 $((attempt + 1)) 次嘗試）"
    sleep "$d"
    attempt=$((attempt + 1))
  done
}
