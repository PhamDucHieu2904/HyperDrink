/** Appearance data is independent of model geometry and viewer presentation. */
export const showcaseFlavors = [
  { id:'citrus', name:'Citrus Bliss', short:'Citrus', image:'citrus-preview.jpg', note:'Cam mọng nước, chanh xanh và một chút ngọt ngào.', color:'#ff895b', background:'#d17a32', labelColors:['#ee6b4f','#f4a13e','#f8ce4d'] as [string,string,string] },
  { id:'berry', name:'Berry Fusion', short:'Berry', image:'berry-preview.jpg', note:'Hương dâu và quả mọng, tươi sáng và đầy cá tính.', color:'#e66b97', background:'#b84b88', labelColors:['#a83e82','#e86b91','#f2acd1'] as [string,string,string] },
  { id:'peach', name:'Peach Glow', short:'Peach', image:'peach-preview.jpg', note:'Đào vàng dịu ngọt, mang theo hương thơm mùa hè.', color:'#ffa877', background:'#d88469', labelColors:['#ee7b5a','#ffb184','#ffd599'] as [string,string,string] },
  { id:'lime', name:'Lime Burst', short:'Lime', image:'lime-preview.jpg', note:'Chanh xanh thanh mát, đánh thức mọi giác quan.', color:'#a5c953', background:'#7da53f', labelColors:['#629c38','#a6ca49','#dfec9b'] as [string,string,string] },
] as const;
