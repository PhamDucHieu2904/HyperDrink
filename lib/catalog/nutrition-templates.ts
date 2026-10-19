import type { NutritionRow } from './contracts';

export type NutritionTemplateId = 'basic' | 'basic-dv' | 'us-serving' | 'us-container' | 'canada';

export interface NutritionTemplate {
  id: NutritionTemplateId;
  name: string;
  description: string;
  amountHeading: string;
  dailyHeading?: string;
  secondaryAmountHeading?: string;
  secondaryDailyHeading?: string;
  rows: string[];
  servingPlaceholder: string;
}

const basicRows = ['Calories / Calories (kcal)', 'Total Fat / Lipides totaux (g)', 'Saturated Fat / Gras saturés (g)', 'Trans Fat / Gras trans (g)', 'Cholesterol / Cholestérol (mg)', 'Sodium / Sodium (mg)', 'Total Carbohydrates / Glucides totaux (g)', 'Total Sugar / Sucres totaux (g)', 'Protein / Protéines (g)'];
const usRows = ['Calories (kcal)', 'Total Fat', 'Saturated Fat', 'Trans Fat', 'Cholesterol', 'Sodium', 'Total Carbohydrate', 'Dietary Fiber', 'Total Sugars', 'Includes Added Sugars', 'Protein', 'Vitamin D', 'Calcium', 'Iron', 'Potassium'];
const canadaRows = ['Fat / Lipides', 'Saturated / saturés', '+Trans / trans', 'Carbohydrate / Glucides', 'Fibre / Fibres', 'Sugars / Sucres', 'Protein / Protéines', 'Cholesterol / Cholestérol', 'Sodium', 'Potassium', 'Calcium', 'Iron / Fer'];

export const nutritionTemplates: readonly NutritionTemplate[] = [
  { id: 'basic', name: 'Cơ bản', description: 'Bảng song ngữ gọn, một cột hàm lượng theo 100 ml.', amountHeading: 'Per 100 mL', rows: basicRows, servingPlaceholder: 'Per 100 ml' },
  { id: 'basic-dv', name: 'Cơ bản có %DV', description: 'Bảng cơ bản thêm cột % giá trị hàng ngày.', amountHeading: 'Per 100 ml', dailyHeading: '%DV', rows: ['Calories (kcal)', 'Total Fat (g)', 'Saturated Fat (g)', 'Trans Fat (g)', 'Cholesterol (mg)', 'Sodium (mg)', 'Total Carbohydrates (g)', 'Total Sugar (g)', 'Protein (g)'], servingPlaceholder: 'Per 100 ml' },
  { id: 'us-serving', name: 'Form Mỹ · 1 khẩu phần', description: 'Nutrition Facts kiểu Mỹ với Calories nổi bật theo khẩu phần.', amountHeading: 'Amount per serving', dailyHeading: '% Daily Value*', rows: usRows, servingPlaceholder: '1 serving per container · 1 Can (490 mL)' },
  { id: 'us-container', name: 'Form Mỹ · khẩu phần & cả chai', description: 'Hai cột số liệu: mỗi khẩu phần và toàn bộ chai.', amountHeading: 'Per serving', secondaryAmountHeading: 'Per container', dailyHeading: '% DV*', secondaryDailyHeading: '% DV* · per container', rows: usRows, servingPlaceholder: '3 servings per container · 16.9 fl oz (500 mL)' },
  { id: 'canada', name: 'Form Canada · song ngữ', description: 'Bảng Canada với tên chỉ tiêu Anh / Pháp.', amountHeading: 'Amount', dailyHeading: '% Daily Value*', rows: canadaRows, servingPlaceholder: 'Per 1 cup (490 mL) · Pour 1 tasse (490 mL)' },
];

export function getNutritionTemplate(id: NutritionTemplateId | undefined): NutritionTemplate {
  return nutritionTemplates.find(template => template.id === id) ?? nutritionTemplates[0];
}

/** Compare the English side of bilingual labels while ignoring display units. */
const key = (value: string) => value
  .split('/')[0]
  .replace(/^\s*\+/, '')
  .replace(/\([^)]*\)/g, '')
  .toLocaleLowerCase()
  .replace(/\bcarbohydrates\b/g, 'carbohydrate')
  .replace(/\bsugars\b/g, 'sugar')
  .replace(/[^a-z0-9]+/g, '')
  .trim();

export function rowsForNutritionTemplate(templateId: NutritionTemplateId | undefined, existing: NutritionRow[]): NutritionRow[] {
  const template = getNutritionTemplate(templateId);
  const available = [...existing];
  const used = new Set<number>();
  const matches = template.rows.map(label => {
    const index = available.findIndex((row, at) => !used.has(at) && key(row.label) === key(label));
    if (index >= 0) used.add(index);
    return index;
  });
  const mapped = template.rows.map((label, templateIndex) => {
    const index = matches[templateIndex];
    if (index >= 0) {
      const row = available[index];
      return { ...row, label };
    }
    return { label, amount: '', dailyValue: '' };
  });
  return mapped;
}
