import type { Locale } from './catalog';

const english = {
  title: 'Model controls', offset: 'Label offset', offsetHint: 'Horizontal alignment · 0% is the original position',
  lid: 'Lid', water: 'Water color', body: 'Body finish', label: 'Label finish',
  color: 'Color', metallic: 'Metallic', smoothness: 'Smoothness', reset: 'Reset materials',
  unavailable: 'This model has no separate material for this part.',
};
export type MockupMaterialCopy = Record<keyof typeof english, string>;
function translated(values: string[]): MockupMaterialCopy {
  const keys = Object.keys(english);
  if (values.length !== keys.length) throw new Error('Incomplete material control translation.');
  return Object.fromEntries(keys.map((key, i) => [key, values[i]])) as MockupMaterialCopy;
}
export const mockupMaterialCopy: Record<Locale, MockupMaterialCopy> = {
  en: english,
  fr: translated(['Réglages du modèle','Décalage de l’étiquette','Alignement horizontal · 0% est la position initiale','Bouchon','Couleur du liquide','Finition du corps','Finition de l’étiquette','Couleur','Métallique','Lissage','Réinitialiser les matériaux','Ce modèle ne possède pas de matériau séparé pour cette partie.']),
  zh: translated(['模型调整','标签偏移','水平对齐 · 0% 为原始位置','瓶盖','液体颜色','瓶身表面','标签表面','颜色','金属度','光滑度','重置材质','此模型没有此部分的独立材质。']),
  es: translated(['Ajustes del modelo','Desplazamiento de etiqueta','Alineación horizontal · 0% es la posición original','Tapa','Color del líquido','Acabado del cuerpo','Acabado de etiqueta','Color','Metálico','Suavidad','Restablecer materiales','Este modelo no tiene un material separado para esta parte.']),
  ar: translated(['إعدادات النموذج','إزاحة الملصق','محاذاة أفقية · 0% هو الموضع الأصلي','الغطاء','لون السائل','سطح الجسم','سطح الملصق','اللون','المعدنية','النعومة','إعادة ضبط المواد','هذا النموذج لا يحتوي على مادة منفصلة لهذا الجزء.']),
  ru: translated(['Настройки модели','Смещение этикетки','По горизонтали · 0% — исходное положение','Крышка','Цвет жидкости','Поверхность корпуса','Поверхность этикетки','Цвет','Металличность','Гладкость','Сбросить материалы','У этой модели нет отдельного материала для этой части.']),
  ko: translated(['모델 조정','라벨 오프셋','수평 정렬 · 0%는 원래 위치','뚜껑','액체 색상','몸체 표면','라벨 표면','색상','금속성','매끄러움','재질 초기화','이 모델에는 이 부분의 별도 재질이 없습니다.']),
  de: translated(['Modelleinstellungen','Etikettenversatz','Horizontale Ausrichtung · 0% ist die Ausgangsposition','Deckel','Flüssigkeitsfarbe','Körperoberfläche','Etikettenoberfläche','Farbe','Metallisch','Glätte','Materialien zurücksetzen','Dieses Modell hat kein separates Material für diesen Teil.']),
};
