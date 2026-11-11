import type { AppLanguage } from '../services/presentationPreferences';

const rows: Record<AppLanguage, readonly [string, string, string]> = {
  en: ['Service fee', 'Includes provider charges and any GetYourSats fee.', 'Fee unavailable'],
  hi: ['सेवा शुल्क', 'इसमें प्रदाता का शुल्क और लागू होने पर GetYourSats का शुल्क शामिल है।', 'शुल्क उपलब्ध नहीं'],
  es: ['Comisión de servicio', 'Incluye los cargos del proveedor y cualquier comisión de GetYourSats.', 'Comisión no disponible'],
  pt: ['Taxa de serviço', 'Inclui os encargos do fornecedor e qualquer taxa da GetYourSats.', 'Taxa indisponível'],
  ja: ['サービス手数料', '提供元の手数料と、適用される場合はGetYourSatsの手数料を含みます。', '手数料を取得できません'],
  th: ['ค่าบริการ', 'รวมค่าธรรมเนียมของผู้ให้บริการและค่าธรรมเนียม GetYourSats หากมี', 'ไม่สามารถแสดงค่าธรรมเนียมได้'],
  vi: ['Phí dịch vụ', 'Bao gồm phí nhà cung cấp và phí GetYourSats nếu có.', 'Không có thông tin phí'],
  ta: ['சேவைக் கட்டணம்', 'வழங்குநரின் கட்டணமும், பொருந்தினால் GetYourSats கட்டணமும் இதில் அடங்கும்.', 'கட்டண விவரம் கிடைக்கவில்லை'],
  ar: ['رسوم الخدمة', 'تشمل رسوم المزوّد وأي رسوم تفرضها GetYourSats.', 'الرسوم غير متاحة'],
  'zh-CN': ['服务费', '包含服务商费用及适用的GetYourSats费用。', '费用暂不可用'],
};

export function crossChainFeeCopy(language: AppLanguage) {
  const [serviceFee, included, unavailable] = rows[language];
  const [estimatedCost, includedServiceFee, networkFeeLimit, maximumDebit] = sendRows[language];
  return { serviceFee, included, unavailable, estimatedCost, includedServiceFee, networkFeeLimit, maximumDebit };
}

const sendRows: Record<AppLanguage, readonly [string, string, string, string]> = {
  en: ['Estimated conversion cost', 'Included service fee', 'Network fee limit', 'Maximum debit'],
  hi: ['अनुमानित रूपांतरण लागत', 'शामिल सेवा शुल्क', 'नेटवर्क शुल्क की सीमा', 'अधिकतम कटौती'],
  es: ['Coste estimado de conversión', 'Comisión de servicio incluida', 'Límite de comisión de red', 'Débito máximo'],
  pt: ['Custo estimado de conversão', 'Taxa de serviço incluída', 'Limite da taxa de rede', 'Débito máximo'],
  ja: ['換算コストの見積もり', '含まれるサービス手数料', 'ネットワーク手数料の上限', '最大引き落とし額'],
  th: ['ต้นทุนการแปลงโดยประมาณ', 'ค่าบริการที่รวมแล้ว', 'วงเงินค่าธรรมเนียมเครือข่าย', 'ยอดหักสูงสุด'],
  vi: ['Chi phí chuyển đổi ước tính', 'Phí dịch vụ đã bao gồm', 'Giới hạn phí mạng', 'Số tiền trừ tối đa'],
  ta: ['மதிப்பிடப்பட்ட மாற்றுச் செலவு', 'உள்ளடங்கிய சேவைக் கட்டணம்', 'நெட்வொர்க் கட்டண வரம்பு', 'அதிகபட்சப் பிடித்தம்'],
  ar: ['تكلفة التحويل المقدّرة', 'رسوم الخدمة المشمولة', 'الحد الأقصى لرسوم الشبكة', 'أقصى مبلغ يُخصم'],
  'zh-CN': ['预估兑换成本', '已包含的服务费', '网络费用上限', '最大扣款额'],
};
