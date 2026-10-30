import type {AppLanguage} from '../services/presentationPreferences';
type MarketCopy = {title:string;currency:string;amount:string;for:string;updated:string;last:string;indicative:string;refresh:string;refreshing:string};
export const MARKET_COPY: Record<AppLanguage, MarketCopy> = {
 en:{title:'Bitcoin market',currency:'Cycle preferred fiat currency',amount:'Bitcoin amount for market price',for:'for',updated:'Updated',last:'Last known rate',indicative:'Indicative only',refresh:'Refresh',refreshing:'Refreshing'},
 hi:{title:'बिटकॉइन बाज़ार',currency:'पसंदीदा मुद्रा बदलें',amount:'बाज़ार भाव के लिए बिटकॉइन की मात्रा',for:'के लिए',updated:'अपडेट किया गया',last:'अंतिम उपलब्ध दर',indicative:'केवल अनुमान',refresh:'ताज़ा करें',refreshing:'ताज़ा हो रहा है'},
 es:{title:'Mercado de Bitcoin',currency:'Cambiar moneda preferida',amount:'Cantidad de Bitcoin para el precio',for:'por',updated:'Actualizado',last:'Última tasa conocida',indicative:'Solo orientativo',refresh:'Actualizar',refreshing:'Actualizando'},
 pt:{title:'Mercado Bitcoin',currency:'Mudar moeda preferida',amount:'Quantidade de Bitcoin para o preço',for:'por',updated:'Atualizado',last:'Última taxa conhecida',indicative:'Apenas indicativo',refresh:'Atualizar',refreshing:'A atualizar'},
 ja:{title:'ビットコイン市場',currency:'優先通貨を切り替える',amount:'価格を表示するビットコイン数量',for:'対象',updated:'更新',last:'最終取得レート',indicative:'参考価格',refresh:'更新',refreshing:'更新中'},
 th:{title:'ตลาดบิตคอยน์',currency:'เปลี่ยนสกุลเงินที่เลือก',amount:'จำนวนบิตคอยน์สำหรับราคาตลาด',for:'สำหรับ',updated:'อัปเดต',last:'อัตราล่าสุดที่ทราบ',indicative:'ราคาโดยประมาณ',refresh:'รีเฟรช',refreshing:'กำลังรีเฟรช'},
 vi:{title:'Thị trường Bitcoin',currency:'Đổi tiền tệ ưu tiên',amount:'Lượng Bitcoin để xem giá',for:'cho',updated:'Cập nhật',last:'Tỷ giá gần nhất',indicative:'Chỉ tham khảo',refresh:'Làm mới',refreshing:'Đang làm mới'},
 ta:{title:'பிட்காயின் சந்தை',currency:'விருப்ப நாணயத்தை மாற்று',amount:'சந்தை விலைக்கான பிட்காயின் அளவு',for:'இதற்கு',updated:'புதுப்பிக்கப்பட்டது',last:'கடைசியாக அறியப்பட்ட விகிதம்',indicative:'மதிப்பீடு மட்டுமே',refresh:'புதுப்பி',refreshing:'புதுப்பிக்கிறது'},
 ar:{title:'سوق بيتكوين',currency:'تبديل العملة المفضلة',amount:'كمية بيتكوين لعرض السعر',for:'لكل',updated:'تم التحديث',last:'آخر سعر معروف',indicative:'سعر تقديري',refresh:'تحديث',refreshing:'جارٍ التحديث'},
 'zh-CN':{title:'比特币市场',currency:'切换首选货币',amount:'查看市价的比特币数量',for:'对应',updated:'更新于',last:'上次已知汇率',indicative:'仅供参考',refresh:'刷新',refreshing:'刷新中'},
};
