import { LinearGradient } from 'expo-linear-gradient';
import { Image, StyleSheet, View } from 'react-native';

/**
 * Fundo da tela de login no app nativo: quadro do vídeo de introdução
 * (o vídeo em si toca no webapp, FundoLogin.web.tsx). Tocar o vídeo aqui
 * pede o expo-video, que exige build nova da loja.
 */
const POSTER = require('../../assets/fundo/intro-v-1.jpg');

export function FundoLogin() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Image source={POSTER} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <LinearGradient
        style={StyleSheet.absoluteFill}
        colors={['rgba(7,10,30,0.55)', 'rgba(7,10,30,0.12)', 'rgba(7,10,30,0.12)', 'rgba(7,10,30,0.74)']}
        locations={[0, 0.28, 0.62, 1]}
      />
    </View>
  );
}
