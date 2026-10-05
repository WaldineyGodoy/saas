import { useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { colors, type } from '../theme/tokens';

export type Serie = { label: string; values: (number | null)[]; color: string };

/** Barras agrupadas simples (historico de consumo/injecao, geracao mensal).
 *  `categories` vem do mais antigo para o mais novo. */
export function BarChart({ categories, series, height = 150, highlightLast }: {
  categories: string[];
  series: Serie[];
  height?: number;
  highlightLast?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const max = Math.max(1, ...series.flatMap((s) => s.values.map((v) => v ?? 0)));
  const n = categories.length;
  const groupW = n ? width / n : 0;
  const barW = Math.max(4, Math.min(18, (groupW * 0.7) / Math.max(1, series.length)));

  return (
    <View>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
        {width > 0 && (
          <Svg width={width} height={height}>
            {categories.map((_, i) =>
              series.map((s, j) => {
                const v = s.values[i] ?? 0;
                const h = Math.max(v > 0 ? 2 : 0, (v / max) * (height - 4));
                const x = i * groupW + (groupW - barW * series.length) / 2 + j * barW;
                const fade = highlightLast && i !== n - 1 ? 0.45 : 1;
                return <Rect key={`${i}-${j}`} x={x} y={height - h} width={barW - 2} height={h} rx={2} fill={s.color} opacity={fade} />;
              }),
            )}
          </Svg>
        )}
      </View>
      <View style={{ flexDirection: 'row', marginTop: 6 }}>
        {categories.map((c, i) => (
          <Text key={i} style={[type.labelSm, { flex: 1, textAlign: 'center', color: colors.inkMuted }]}>{c}</Text>
        ))}
      </View>
      {series.length > 1 && (
        <View style={{ flexDirection: 'row', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
          {series.map((s) => (
            <View key={s.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: s.color }} />
              <Text style={[type.bodySm, { color: colors.inkSecondary }]}>{s.label}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
