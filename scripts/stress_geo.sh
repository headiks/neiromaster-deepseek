#!/bin/bash
# Стресс-тест «вся Россия»: по контейнеру-генератору на регион (scripts/stress_geo.py), у
# каждого — сеть региона (tc netem: задержка, разброс, потери, скорость), свои IP провайдеров
# и доля сотрудников. Запускать на сервере из корня репозитория:
#
#     cd ~/neiromaster && git pull && nohup bash scripts/stress_geo.sh > ~/stress_geo.out 2>&1 &
#     tail -f ~/stress_geo.out                     # ход теста
#
# Параметры передаются генераторам: --stages 500,1000,2000,3000 (сотрудников на всю Россию по
# ступеням), --stage-min 3 (минут на ступень). Тестовые сотрудники stress-geo-* создаются и
# удаляются самими генераторами; при прерывании (Ctrl+C, ошибка) — ловушкой ниже.
# Итог: ~/stress_geo/report.txt, нагрузка сервера по времени — ~/stress_geo/stats.log.
set -uo pipefail
cd "$(dirname "$0")/.."
ARGS="$*"
DC="sudo docker compose"
D="sudo docker"
OUT=~/stress_geo
mkdir -p "$OUT" && rm -f "$OUT"/*.log "$OUT"/report.txt
REGIONS=$(python3 scripts/stress_geo.py regions)
NAMES=$(echo "$REGIONS" | awk '{print "nm-geo-" $1}')

redis() { $DC exec -T redis redis-cli "$@" </dev/null; }   # не читать чужой stdin в циклах

cleanup() {
    echo "== уборка"
    [ -n "${STATS_PID:-}" ] && kill "$STATS_PID" 2>/dev/null
    $D rm -f $NAMES >/dev/null 2>&1
    $DC exec -T web python -c "
import db
ids = [r['id'] for r in db.query('SELECT id FROM users WHERE username LIKE %s', ('stress-geo-%',)) or []]
for t, c in (('sessions','user_id'),('scheduled_messages','employee_id'),('push_tokens','user_id'),('questions','user_id'),('activity_log','user_id')):
    db.execute(f'DELETE FROM {t} WHERE {c} = ANY(%s)', (ids,))
db.execute('DELETE FROM users WHERE id = ANY(%s)', (ids,))
print('тестовых сотрудников удалено:', len(ids))"
    redis DEL nm:geo:go nm:geo:ready >/dev/null
}
trap 'cleanup; exit 1' INT TERM

echo "== подготовка: $(echo "$REGIONS" | wc -l) регионов, параметры: ${ARGS:-по умолчанию}"
$D rm -f $NAMES >/dev/null 2>&1
redis DEL nm:geo:go nm:geo:ready >/dev/null
while read -r reg rtt jit loss rate; do
    redis DEL "nm:geo:netem:$reg" </dev/null >/dev/null
    $DC run -d --no-deps --name "nm-geo-$reg" -v "$PWD/scripts:/app/scripts" web \
        python scripts/stress_geo.py run --region "$reg" $ARGS </dev/null >/dev/null || { echo "не запустился $reg"; cleanup; exit 1; }
done <<< "$REGIONS"

echo "== сеть регионов (tc netem)"
while read -r reg rtt jit loss rate; do
    shape="delay ${rtt}ms ${jit}ms distribution normal loss ${loss}%"
    [ "$rate" != "-" ] && shape="$shape rate $rate"
    if $D run --rm --net "container:nm-geo-$reg" --cap-add NET_ADMIN alpine:3 sh -c \
        "apk add -q --no-cache iproute2 >/dev/null && for i in \$(ls /sys/class/net | grep -v '^lo\$'); do tc qdisc replace dev \$i root netem $shape || exit 1; done" \
        </dev/null >/dev/null 2>&1; then
        redis SET "nm:geo:netem:$reg" ok </dev/null >/dev/null
        echo "  $reg: $shape"
    else
        echo "  $reg: netem недоступен — задержка $rtt±$jit мс эмулируется в коде"
    fi
done <<< "$REGIONS"

echo "== ждём, пока генераторы создадут сотрудников"
total=$(echo "$REGIONS" | wc -l)
for _ in $(seq 1 600); do
    ready=$(redis SCARD nm:geo:ready | tr -dc 0-9)
    [ "${ready:-0}" -ge "$total" ] && break
    for n in $NAMES; do
        [ "$($D inspect -f '{{.State.Running}}' "$n" 2>/dev/null)" = "true" ] || { echo "генератор $n упал:"; $D logs --tail 20 "$n"; cleanup; exit 1; }
    done
    sleep 2
done

(while true; do echo "--- $(date +%H:%M:%S) load $(cut -d' ' -f1-3 /proc/loadavg)"
    $D stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' | grep -v nm-geo; sleep 30; done) > "$OUT/stats.log" 2>&1 &
STATS_PID=$!

echo "== старт $(date +%H:%M:%S)"
redis SET nm:geo:go 1 >/dev/null
for n in $NAMES; do
    $D logs -f "$n" 2>&1 | grep -a --line-buffered "^\[" &
done
for n in $NAMES; do $D wait "$n" >/dev/null; done
kill "$STATS_PID" 2>/dev/null
for n in $NAMES; do $D logs "$n" > "$OUT/${n#nm-geo-}.log" 2>&1; done
$D rm -f $NAMES >/dev/null
redis DEL nm:geo:go nm:geo:ready >/dev/null

echo "== итог"
python3 scripts/stress_geo.py report "$OUT"/*.log | tee "$OUT/report.txt"
echo
echo "Пиковая нагрузка сервера (load average за 1 мин): $(grep -o 'load [0-9.]*' "$OUT/stats.log" | awk '{print $2}' | sort -n | tail -1)"
echo "Тестовых сотрудников после теста: $($DC exec -T web python -c 'import db; print(db.query("SELECT count(*) AS n FROM users WHERE username LIKE %s", ("stress-geo-%",), "one")["n"])')"
