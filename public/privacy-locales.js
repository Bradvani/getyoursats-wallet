// Privacy content and contact labels shared by both public origins.
window.GYS_PRIVACY = {
  "en": {
    "title": "Privacy notice",
    "intro": "This is GetYourSats’ current beta privacy notice. It explains the information used by the wallet and optional account services. A final legal review is still needed before a wider commercial launch.",
    "warning": "Never share recovery words, private keys, PINs or passkey credentials with us. Support and email verification do not need them. A verified email cannot restore lost wallet keys.",
    "headings": [
      "Wallet and payment information",
      "Device and passkeys",
      "Email and Lightning addresses",
      "Service providers",
      "Support and deletion",
      "Updates"
    ],
    "paragraphs": [
      "GetYourSats is intended as a self-custodial wallet built with the Breez Spark SDK. The app and your chosen device or passkey recovery method handle signing keys and recovery information. Spark operators and related Lightning and payment services process technical wallet identities, payment requests and settlement data to operate the network. Bitcoin transactions recorded on the blockchain are public.",
      "Your device or password manager handles passkey authentication. GetYourSats does not need your biometric image or device unlock PIN. Keep your wallet’s recovery words private and offline. The wallet may keep local state to reconnect. Clearing browser or PWA storage can prevent access if you have no independent backup.",
      "If email verification is enabled and you choose it, Upstash stores your email linked to your public wallet identity and a verification timestamp. Verification uses wallet-signed challenges and temporary code records. Challenges expire after 5 minutes and codes after 10 minutes. Resend delivers these emails. The verified email link has no automatic expiry; it remains until a supported removal process is completed. Email is not a wallet sign-in or recovery method and cannot restore funds.",
      "When personalized Lightning addresses are enabled, registering or changing username@getyoursats.com through Breez requires a verified email linked to that wallet. Receiving through an existing address does not require an email check. A Lightning address is public: anyone who knows it can look it up.",
      "Vercel hosts the website and deployments. Breez and Spark services support wallet operations. If enabled, a third-party Bitcoin purchase provider handles its own purchase process, eligibility and identity checks (KYC) under separate terms. GetYourSats does not currently claim that a purchase can be completed in the app.",
      "When you contact us, we process what you submit. Use the private contact form for privacy questions, stored account information, email unlinking or Lightning address removal requests. Requests are reviewed; sending the form does not automatically delete records or remove an address. We may ask for proof that you control the linked wallet, but never recovery words, private keys or passkey credentials.",
      "Signing out, clearing browser storage or deleting the app does not automatically unlink a verified email or remove a Lightning address. Removing server-held account information does not erase public Bitcoin transactions or records controlled by other services.",
      "We may update this notice as more services become available. Product claims should match the deployed wallet and verified integrations. Policy content updated: 26 October 2026. Translation updated: 27 October 2026."
    ],
    "ui": [
      "Privacy",
      "Support",
      "Open wallet ↗",
      "Language",
      "On this page",
      "Home",
      "Account removal",
      "Contact the team",
      "GetYourSats homepage",
      "Main navigation",
      "Footer navigation"
    ],
    "form": {
      "formTitle": "Contact the team",
      "formIntro": "Never share recovery words or private keys.",
      "formName": "Name (optional)",
      "formEmail": "Reply email",
      "formTopic": "What can we help with?",
      "formMessage": "How can we help?",
      "formConsent": "I will not submit any private keys, recovery words, passwords or passkey credentials.",
      "formSend": "Send message",
      "formWait": "The contact form is unavailable. Please try again later.",
      "formOk": "Message accepted. Your reference: ",
      "formErr": "Unable to send. Please try again.",
      "formSending": "Sending…",
      "topicPrompt": "Choose an enquiry type",
      "supportLimit": "We can help investigate app or payment issues. We cannot restore lost seed phrases, private keys or inaccessible self-custodial wallets.",
      "topics": [
        "Wallet & payment help",
        "Product feedback & ideas",
        "Partnerships & affiliations",
        "Media & community collaborations",
        "Privacy & data requests",
        "General enquiry"
      ]
    }
  },
  "hi": {
    "title": "गोपनीयता सूचना",
    "intro": "यह GetYourSats की मौजूदा बीटा गोपनीयता सूचना है। इसमें वॉलेट और वैकल्पिक खाता सेवाओं में इस्तेमाल होने वाली जानकारी का वर्णन है। बड़े व्यावसायिक लॉन्च से पहले अंतिम कानूनी समीक्षा अभी बाकी है।",
    "warning": "रिकवरी शब्द, निजी कुंजियाँ, PIN या passkey की गुप्त जानकारी हमें कभी न भेजें। सहायता और ईमेल सत्यापन के लिए इनकी ज़रूरत नहीं होती। सत्यापित ईमेल खोई हुई वॉलेट कुंजियाँ वापस नहीं ला सकता।",
    "headings": [
      "वॉलेट और भुगतान की जानकारी",
      "डिवाइस और passkey",
      "ईमेल और Lightning पते",
      "सेवा प्रदाता",
      "सहायता और जानकारी हटाना",
      "अपडेट"
    ],
    "paragraphs": [
      "GetYourSats को Breez Spark SDK पर बना स्व-अभिरक्षा वॉलेट बनाने का उद्देश्य है। ऐप और आपका चुना हुआ डिवाइस या passkey रिकवरी तरीका, भुगतान पर हस्ताक्षर करने वाली कुंजियों और रिकवरी जानकारी को संभालते हैं। नेटवर्क चलाने के लिए Spark ऑपरेटर और संबंधित Lightning व भुगतान सेवाएँ वॉलेट की तकनीकी पहचान, भुगतान अनुरोध और निपटान की जानकारी का उपयोग करती हैं। Bitcoin ब्लॉकचेन पर दर्ज लेनदेन सार्वजनिक होते हैं।",
      "passkey प्रमाणीकरण आपका डिवाइस या पासवर्ड मैनेजर संभालता है। GetYourSats को आपकी बायोमेट्रिक तस्वीर या डिवाइस खोलने वाला PIN नहीं चाहिए। अपने वॉलेट के रिकवरी शब्द निजी और ऑफलाइन रखें। दोबारा जुड़ने के लिए वॉलेट डिवाइस पर कुछ जानकारी रख सकता है। अलग बैकअप न होने पर ब्राउज़र या PWA का डेटा मिटाने से वॉलेट तक पहुँच खो सकती है।",
      "ईमेल सत्यापन उपलब्ध होने पर यदि आप इसे चुनते हैं, तो Upstash आपके ईमेल को वॉलेट की सार्वजनिक पहचान और सत्यापन के समय से जोड़कर रखता है। सत्यापन में वॉलेट से हस्ताक्षरित अनुरोध और अस्थायी कोड रिकॉर्ड इस्तेमाल होते हैं। अनुरोध 5 मिनट और कोड 10 मिनट में समाप्त होते हैं। Resend ईमेल भेजता है। सत्यापित ईमेल का जुड़ाव अपने आप समाप्त नहीं होता; हटाने की समर्थित प्रक्रिया पूरी होने तक बना रहता है। ईमेल से वॉलेट में प्रवेश, रिकवरी या रकम वापस नहीं मिल सकती।",
      "व्यक्तिगत Lightning पते उपलब्ध होने पर Breez के ज़रिए username@getyoursats.com बनाने या बदलने के लिए उसी वॉलेट से जुड़ा सत्यापित ईमेल चाहिए। मौजूदा पते पर भुगतान पाने के लिए ईमेल जाँच ज़रूरी नहीं है। Lightning पता सार्वजनिक है और उसे जानने वाला कोई भी व्यक्ति उसे खोज सकता है।",
      "Vercel वेबसाइट और ऐप की वेब रिलीज़ होस्ट करता है। Breez और Spark वॉलेट चलाने में मदद करते हैं। खरीद सेवा उपलब्ध होने पर बाहरी प्रदाता अपनी शर्तों के तहत खरीद, पात्रता और पहचान जाँच (KYC) संभालता है। GetYourSats फिलहाल यह दावा नहीं करता कि ऐप में खरीद पूरी की जा सकती है।",
      "आप संपर्क करते समय जो जानकारी भेजते हैं, हम उसका उपयोग करते हैं। गोपनीयता, खाते में रखी जानकारी, ईमेल का जुड़ाव हटाने या Lightning पता हटाने के अनुरोध के लिए निजी संपर्क फ़ॉर्म इस्तेमाल करें। हर अनुरोध की समीक्षा होती है; फ़ॉर्म भेजने से रिकॉर्ड या पता अपने आप नहीं हटते। हम जुड़े वॉलेट पर आपके नियंत्रण का प्रमाण माँग सकते हैं, लेकिन रिकवरी शब्द, निजी कुंजियाँ या passkey की गुप्त जानकारी कभी नहीं।",
      "साइन आउट करने, ब्राउज़र डेटा मिटाने या ऐप हटाने से सत्यापित ईमेल का जुड़ाव या Lightning पता अपने आप नहीं हटता। सर्वर पर रखी खाता जानकारी हटाने से सार्वजनिक Bitcoin लेनदेन या दूसरी सेवाओं के रिकॉर्ड नहीं मिटते।",
      "नई सेवाएँ आने पर यह सूचना बदल सकती है। उत्पाद के दावे जारी वॉलेट और जाँचे गए सेवा-संबंधों के अनुसार होने चाहिए। नीति अपडेट: 26 अक्टूबर 2026। अनुवाद अपडेट: 27 अक्टूबर 2026।"
    ],
    "ui": [
      "गोपनीयता",
      "सहायता",
      "वॉलेट खोलें ↗",
      "भाषा",
      "इस पेज पर",
      "होम",
      "खाता हटाना",
      "टीम से संपर्क करें",
      "GetYourSats होमपेज",
      "मुख्य नेविगेशन",
      "फ़ुटर नेविगेशन"
    ],
    "form": {
      "formTitle": "सहायता से संपर्क",
      "formIntro": "रिकवरी शब्द या निजी कुंजियाँ कभी न भेजें।",
      "formName": "नाम (वैकल्पिक)",
      "formEmail": "जवाब के लिए ईमेल",
      "formTopic": "आप किस बारे में पूछना चाहते हैं?",
      "formMessage": "समस्या बताएं",
      "formConsent": "मैं निजी कुंजी, रिकवरी शब्द, पासवर्ड या पासकी डेटा नहीं भेजूँगा/भेजूँगी।",
      "formSend": "संदेश भेजें",
      "formWait": "संपर्क फ़ॉर्म अभी उपलब्ध नहीं है। कृपया बाद में कोशिश करें।",
      "formOk": "संदेश स्वीकार हुआ। संदर्भ: ",
      "formErr": "संदेश नहीं भेजा जा सका। फिर कोशिश करें।",
      "formSending": "भेज रहे हैं…",
      "topicPrompt": "पूछताछ का प्रकार चुनें",
      "supportLimit": "हम ऐप और भुगतान की समस्या जाँच सकते हैं। खोए हुए रिकवरी शब्द, निजी कुंजी या सेल्फ-कस्टडी वॉलेट को हम वापस नहीं ला सकते।",
      "topics": [
        "वॉलेट और भुगतान सहायता",
        "प्रोडक्ट सुझाव और फ़ीडबैक",
        "साझेदारी और एफिलिएट्स",
        "मीडिया और समुदाय सहयोग",
        "गोपनीयता और डेटा अनुरोध",
        "सामान्य पूछताछ"
      ]
    }
  },
  "es": {
    "title": "Aviso de privacidad",
    "intro": "Este es el aviso de privacidad actual de la versión beta de GetYourSats. Explica qué información usan la cartera y los servicios opcionales de cuenta. Aún requiere una revisión jurídica final antes de un lanzamiento comercial más amplio.",
    "warning": "Nunca nos envíes palabras de recuperación, claves privadas, PIN ni credenciales de passkey. No los necesitamos para ayudarte ni verificar tu email. Un email verificado no permite recuperar claves perdidas.",
    "headings": [
      "Información de la cartera y los pagos",
      "Dispositivo y passkeys",
      "Email y direcciones Lightning",
      "Proveedores de servicios",
      "Ayuda y eliminación de datos",
      "Actualizaciones"
    ],
    "paragraphs": [
      "GetYourSats está concebida como una cartera de autocustodia basada en Breez Spark SDK. La aplicación y el método de recuperación elegido, mediante dispositivo o passkey, gestionan las claves de firma y la información de recuperación. Los operadores de Spark y los servicios relacionados de Lightning y pagos procesan identificadores técnicos de cartera, solicitudes de pago y datos de liquidación para operar la red. Las transacciones de Bitcoin registradas en la cadena son públicas.",
      "Tu dispositivo o gestor de contraseñas gestiona la autenticación con passkey. GetYourSats no necesita tu imagen biométrica ni el PIN del dispositivo. Guarda las palabras de recuperación de tu cartera en privado y sin conexión. La cartera puede guardar datos locales para reconectarse. Borrar los datos del navegador o de la PWA puede impedir el acceso si no tienes una copia de seguridad independiente.",
      "Si la verificación por email está disponible y la eliges, Upstash guarda tu email vinculado a la identidad pública de tu cartera y la fecha y hora de verificación. Se utilizan solicitudes firmadas por la cartera y registros temporales de códigos. Las solicitudes caducan en 5 minutos y los códigos en 10 minutos. Resend envía los emails. El vínculo del email verificado no caduca automáticamente: se conserva hasta completar un proceso de eliminación admitido. El email no sirve para iniciar sesión, recuperar la cartera ni recuperar fondos.",
      "Cuando las direcciones Lightning personalizadas están disponibles, registrar o cambiar username@getyoursats.com mediante Breez requiere un email verificado vinculado a esa cartera. Recibir pagos en una dirección existente no requiere comprobar el email. Una dirección Lightning es pública: cualquiera que la conozca puede consultarla.",
      "Vercel aloja el sitio web y sus versiones publicadas. Breez y Spark permiten el funcionamiento de la cartera. Si se habilita la compra de Bitcoin, el proveedor externo gestiona su proceso de compra, los requisitos de acceso y las verificaciones de identidad (KYC) según sus propias condiciones. GetYourSats no afirma actualmente que se pueda completar una compra en la aplicación.",
      "Cuando nos contactas, procesamos la información que envías. Usa el formulario privado para consultas de privacidad, información almacenada de tu cuenta o solicitudes para desvincular un email o retirar una dirección Lightning. Revisamos las solicitudes; enviar el formulario no elimina registros ni direcciones automáticamente. Podemos pedir una prueba de que controlas la cartera vinculada, pero nunca palabras de recuperación, claves privadas ni credenciales de passkey.",
      "Cerrar sesión, borrar los datos del navegador o eliminar la aplicación no desvincula automáticamente un email verificado ni retira una dirección Lightning. Eliminar información de cuenta de nuestros servidores no borra transacciones públicas de Bitcoin ni registros controlados por otros servicios.",
      "Podemos actualizar este aviso cuando se habiliten más servicios. Las afirmaciones del producto deben corresponder a la cartera publicada y a las integraciones verificadas. Política actualizada: 26 de octubre de 2026. Traducción actualizada: 27 de octubre de 2026."
    ],
    "ui": [
      "Privacidad",
      "Ayuda",
      "Abrir cartera ↗",
      "Idioma",
      "En esta página",
      "Inicio",
      "Eliminar cuenta",
      "Contactar al equipo",
      "Inicio de GetYourSats",
      "Navegación principal",
      "Navegación del pie de página"
    ],
    "form": {
      "formTitle": "Contactar al equipo",
      "formIntro": "Nunca envíes palabras de recuperación ni claves privadas.",
      "formName": "Nombre (opcional)",
      "formEmail": "Correo de respuesta",
      "formTopic": "¿En qué podemos ayudarte?",
      "formMessage": "¿Cómo podemos ayudarte?",
      "formConsent": "No enviaré palabras de recuperación, claves privadas, contraseñas ni credenciales de passkey.",
      "formSend": "Enviar mensaje",
      "formWait": "El formulario no está disponible. Inténtalo más tarde.",
      "formOk": "Mensaje aceptado. Referencia: ",
      "formErr": "No se pudo enviar. Inténtalo de nuevo.",
      "formSending": "Enviando…",
      "topicPrompt": "Selecciona el tipo de consulta",
      "supportLimit": "Podemos investigar problemas de la aplicación o los pagos. No podemos recuperar palabras de recuperación, claves privadas ni carteras de autocustodia inaccesibles.",
      "topics": [
        "Ayuda con cartera y pagos",
        "Ideas y sugerencias para el producto",
        "Alianzas y afiliaciones",
        "Medios y comunidad",
        "Privacidad y solicitudes de datos",
        "Consulta general"
      ]
    }
  },
  "pt": {
    "title": "Aviso de privacidade",
    "intro": "Este é o aviso de privacidade atual da versão beta de GetYourSats. Explica a informação usada pela carteira e pelos serviços opcionais da conta. Ainda é necessária uma revisão jurídica final antes de um lançamento comercial mais alargado.",
    "warning": "Nunca nos envie palavras de recuperação, chaves privadas, PIN ou credenciais de passkey. Não são necessários para apoio ou verificação de email. Um email verificado não recupera chaves perdidas.",
    "headings": [
      "Informação da carteira e dos pagamentos",
      "Dispositivo e passkeys",
      "Email e endereços Lightning",
      "Prestadores de serviços",
      "Apoio e eliminação de dados",
      "Atualizações"
    ],
    "paragraphs": [
      "GetYourSats foi concebida como uma carteira de autocustódia baseada no Breez Spark SDK. A aplicação e o método de recuperação escolhido, por dispositivo ou passkey, gerem as chaves de assinatura e a informação de recuperação. Os operadores Spark e os serviços de Lightning e pagamentos associados processam identificadores técnicos da carteira, pedidos de pagamento e dados de liquidação para operar a rede. As transações de Bitcoin registadas na blockchain são públicas.",
      "O dispositivo ou gestor de palavras-passe gere a autenticação por passkey. GetYourSats não precisa da sua imagem biométrica nem do PIN do dispositivo. Mantenha as palavras de recuperação da sua carteira privadas e offline. A carteira pode guardar dados locais para voltar a ligar-se. Apagar os dados do navegador ou da PWA pode impedir o acesso se não tiver uma cópia de segurança independente.",
      "Se a verificação de email estiver disponível e a escolher, o Upstash guarda o email associado à identidade pública da carteira e a data e hora da verificação. São usados pedidos assinados pela carteira e registos temporários de códigos. Os pedidos expiram ao fim de 5 minutos e os códigos ao fim de 10 minutos. O Resend envia os emails. A associação do email verificado não expira automaticamente: mantém-se até concluir um processo de remoção suportado. O email não permite iniciar sessão, recuperar a carteira ou recuperar fundos.",
      "Quando os endereços Lightning personalizados estão disponíveis, registar ou alterar username@getyoursats.com através do Breez exige um email verificado associado à carteira. Receber pagamentos num endereço existente não exige verificar o email. Um endereço Lightning é público: qualquer pessoa que o conheça pode consultá-lo.",
      "O Vercel aloja o site e as versões publicadas. Breez e Spark apoiam o funcionamento da carteira. Se a compra de Bitcoin for ativada, o prestador externo gere a compra, os critérios de acesso e as verificações de identidade (KYC) nos termos das suas próprias condições. GetYourSats não afirma atualmente que seja possível concluir uma compra na aplicação.",
      "Quando nos contacta, tratamos a informação enviada. Use o formulário privado para questões de privacidade, informação guardada da conta ou pedidos para desassociar um email ou remover um endereço Lightning. Os pedidos são analisados; enviar o formulário não elimina automaticamente registos ou endereços. Podemos pedir prova de que controla a carteira associada, mas nunca palavras de recuperação, chaves privadas ou credenciais de passkey.",
      "Terminar sessão, apagar dados do navegador ou eliminar a aplicação não desassocia automaticamente um email verificado nem remove um endereço Lightning. Eliminar informação da conta nos servidores não apaga transações públicas de Bitcoin nem registos controlados por outros serviços.",
      "Podemos atualizar este aviso à medida que surgem novos serviços. As afirmações do produto devem corresponder à carteira publicada e às integrações verificadas. Política atualizada: 26 de outubro de 2026. Tradução atualizada: 27 de outubro de 2026."
    ],
    "ui": [
      "Privacidade",
      "Apoio",
      "Abrir carteira ↗",
      "Idioma",
      "Nesta página",
      "Início",
      "Remover conta",
      "Contactar a equipa",
      "Página inicial de GetYourSats",
      "Navegação principal",
      "Navegação do rodapé"
    ],
    "form": {
      "formTitle": "Contactar a equipa",
      "formIntro": "Nunca envie palavras de recuperação ou chaves privadas.",
      "formName": "Nome (opcional)",
      "formEmail": "Email de resposta",
      "formTopic": "Em que podemos ajudar?",
      "formMessage": "Como podemos ajudar?",
      "formConsent": "Não enviarei palavras de recuperação, chaves privadas, palavras-passe ou credenciais de passkey.",
      "formSend": "Enviar mensagem",
      "formWait": "O formulário está indisponível. Tente novamente mais tarde.",
      "formOk": "Mensagem aceite. Referência: ",
      "formErr": "Falha no envio. Tente novamente.",
      "formSending": "A enviar…",
      "topicPrompt": "Escolha o tipo de pedido",
      "supportLimit": "Podemos analisar problemas na aplicação ou pagamentos. Não podemos recuperar frases de recuperação, chaves privadas ou carteiras de autocustódia inacessíveis.",
      "topics": [
        "Ajuda com a carteira e pagamentos",
        "Sugestões e ideias para o produto",
        "Parcerias e afiliações",
        "Imprensa e comunidade",
        "Privacidade e pedidos de dados",
        "Questão geral"
      ]
    }
  },
  "ja": {
    "title": "プライバシーについて",
    "intro": "これはGetYourSatsの現行ベータ版のプライバシー通知です。ウォレットと任意のアカウントサービスが扱う情報を説明します。商用提供を広げる前に、最終的な法務確認が必要です。",
    "warning": "復元用の単語、秘密鍵、PIN、passkeyの認証情報は絶対に送らないでください。サポートやメール認証には不要です。認証済みメールでも、失ったウォレットの鍵は復元できません。",
    "headings": [
      "ウォレットと支払いの情報",
      "端末とpasskey",
      "メールとLightningアドレス",
      "サービス提供者",
      "問い合わせとデータ削除",
      "更新"
    ],
    "paragraphs": [
      "GetYourSatsはBreez Spark SDKを使った自己管理型ウォレットを目指しています。署名用の鍵と復元情報は、アプリと、選択した端末またはpasskeyによる復元方法で扱われます。Sparkの運営者と関連するLightning・決済サービスは、ネットワークの運用に必要なウォレット識別情報、支払いリクエスト、決済記録を処理します。Bitcoinのブロックチェーン上の取引は公開されます。",
      "passkeyの認証は端末やパスワードマネージャーが管理します。GetYourSatsは生体認証の画像や端末のロック解除PINを必要としません。ウォレットの復元用の単語は、他人に見せずオフラインで保管してください。再接続のため、端末にウォレットの状態を保存する場合があります。別のバックアップがないままブラウザーやPWAのデータを消すと、アクセスできなくなるおそれがあります。",
      "メール認証が利用可能で、利用を選ぶと、Upstashにメールアドレス、関連付けられたウォレットの公開識別情報、認証日時が保存されます。認証にはウォレットで署名した確認リクエストと一時的なコード記録を使います。リクエストは5分、コードは10分で期限切れになります。メールはResendが送信します。認証済みメールの関連付けは自動では失効せず、対応する削除手続きが終わるまで残ります。メールでのウォレットへのログイン、復元、資金の回復はできません。",
      "個人用Lightningアドレスが利用可能な場合、Breez経由でusername@getyoursats.comを登録・変更するには、そのウォレットに関連付けた認証済みメールが必要です。既存アドレスでの受け取りにはメール確認は不要です。Lightningアドレスは公開情報で、知っている人は誰でも照会できます。",
      "Vercelがウェブサイトと公開版をホストします。BreezとSparkのサービスがウォレットの動作を支えます。Bitcoin購入サービスが有効になる場合、外部の提供者が独自の規約に基づいて購入手続き、利用条件、本人確認（KYC）を管理します。現在、GetYourSatsはアプリ内で購入を完了できるとは案内していません。",
      "お問い合わせ時には、送信された情報を処理します。プライバシー、保存されたアカウント情報、メールの関連付け解除、Lightningアドレスの削除については、非公開の問い合わせフォームをご利用ください。申請は確認後に扱われ、フォーム送信だけで記録やアドレスが削除されることはありません。関連付けたウォレットを管理している証明を求める場合がありますが、復元用の単語、秘密鍵、passkeyの認証情報は求めません。",
      "サインアウト、ブラウザーのデータ消去、アプリの削除だけでは、認証済みメールの関連付けやLightningアドレスは削除されません。サーバー上のアカウント情報を削除しても、公開されたBitcoin取引や他社が管理する記録は消せません。",
      "サービスの追加に伴い、この通知を更新する場合があります。製品の説明は、公開中のウォレットと確認済みの連携機能に沿う必要があります。ポリシー更新日：2026年10月26日。翻訳更新日：2026年10月27日。"
    ],
    "ui": [
      "プライバシー",
      "サポート",
      "ウォレットを開く ↗",
      "言語",
      "このページの内容",
      "ホーム",
      "アカウント削除",
      "チームに問い合わせる",
      "GetYourSatsホーム",
      "メインナビゲーション",
      "フッターナビゲーション"
    ],
    "form": {
      "formTitle": "チームに問い合わせる",
      "formIntro": "復元用の単語や秘密鍵は送らないでください。",
      "formName": "名前（任意）",
      "formEmail": "返信先メールアドレス",
      "formTopic": "お問い合わせの種類",
      "formMessage": "どのようなことでお困りですか？",
      "formConsent": "復元用の単語、秘密鍵、パスワード、passkeyの認証情報は送信しません。",
      "formSend": "送信する",
      "formWait": "現在フォームを利用できません。時間をおいて再度お試しください。",
      "formOk": "受け付けました。受付番号：",
      "formErr": "送信できませんでした。入力内容を確認して再度お試しください。",
      "formSending": "送信中…",
      "topicPrompt": "種類を選んでください",
      "supportLimit": "アプリや支払いの問題を調査できますが、失った鍵や復元用の単語、アクセスできない自己管理型ウォレットは復元できません。",
      "topics": [
        "ウォレットと支払い",
        "製品へのご意見",
        "提携",
        "メディアとコミュニティ",
        "プライバシーとデータ",
        "その他"
      ]
    }
  },
  "th": {
    "title": "ความเป็นส่วนตัว",
    "intro": "นี่คือประกาศความเป็นส่วนตัวของ GetYourSats รุ่นเบตาปัจจุบัน อธิบายข้อมูลที่กระเป๋าและบริการบัญชีเสริมใช้ ยังต้องผ่านการตรวจสอบทางกฎหมายขั้นสุดท้ายก่อนเปิดให้บริการเชิงพาณิชย์ในวงกว้าง",
    "warning": "อย่าส่งคำกู้คืน กุญแจส่วนตัว PIN หรือข้อมูลรับรอง passkey ให้เรา การขอความช่วยเหลือและยืนยันอีเมลไม่ต้องใช้ข้อมูลเหล่านี้ อีเมลที่ยืนยันแล้วกู้คืนกุญแจกระเป๋าที่หายไปไม่ได้",
    "headings": [
      "ข้อมูลกระเป๋าและการชำระเงิน",
      "อุปกรณ์และ passkey",
      "อีเมลและที่อยู่ Lightning",
      "ผู้ให้บริการ",
      "ความช่วยเหลือและการลบข้อมูล",
      "การปรับปรุง"
    ],
    "paragraphs": [
      "GetYourSats มีเป้าหมายเป็นกระเป๋าที่ผู้ใช้ดูแลกุญแจเอง สร้างด้วย Breez Spark SDK แอปและวิธีกู้คืนที่คุณเลือกผ่านอุปกรณ์หรือ passkey จัดการกุญแจลงนามและข้อมูลกู้คืน ผู้ดำเนินการ Spark และบริการ Lightning และการชำระเงินที่เกี่ยวข้องประมวลผลตัวระบุกระเป๋าทางเทคนิค คำขอชำระเงินและข้อมูลการชำระบัญชีเพื่อให้เครือข่ายทำงาน ธุรกรรม Bitcoin ที่บันทึกบนบล็อกเชนเป็นข้อมูลสาธารณะ",
      "อุปกรณ์หรือตัวจัดการรหัสผ่านจัดการการยืนยันตัวตนด้วย passkey GetYourSats ไม่ต้องการภาพข้อมูลชีวมิติหรือ PIN ปลดล็อกอุปกรณ์ เก็บคำกู้คืนของกระเป๋าเป็นส่วนตัวและออฟไลน์ กระเป๋าอาจเก็บข้อมูลในอุปกรณ์เพื่อเชื่อมต่อใหม่ การลบข้อมูลเบราว์เซอร์หรือ PWA อาจทำให้เข้าถึงกระเป๋าไม่ได้หากไม่มีข้อมูลสำรองแยกไว้",
      "หากมีบริการยืนยันอีเมลและคุณเลือกใช้ Upstash จะเก็บอีเมลที่เชื่อมกับตัวระบุสาธารณะของกระเป๋าและเวลาที่ยืนยัน ระบบใช้คำขอที่กระเป๋าลงนามและบันทึกรหัสชั่วคราว คำขอหมดอายุใน 5 นาที รหัสหมดอายุใน 10 นาที Resend ส่งอีเมลเหล่านี้ การเชื่อมอีเมลที่ยืนยันแล้วไม่หมดอายุอัตโนมัติ และคงอยู่จนกระบวนการลบที่รองรับเสร็จสิ้น อีเมลใช้เข้าสู่กระเป๋า กู้คืนกระเป๋าหรือกู้คืนเงินไม่ได้",
      "เมื่อเปิดใช้ที่อยู่ Lightning ส่วนตัว การลงทะเบียนหรือเปลี่ยน username@getyoursats.com ผ่าน Breez ต้องใช้อีเมลที่ยืนยันแล้วและเชื่อมกับกระเป๋านั้น การรับเงินผ่านที่อยู่เดิมไม่ต้องตรวจสอบอีเมล ที่อยู่ Lightning เป็นข้อมูลสาธารณะ ใครก็ตามที่รู้ที่อยู่สามารถค้นหาได้",
      "Vercel ให้บริการโฮสต์เว็บไซต์และรุ่นที่เผยแพร่ Breez และ Spark ช่วยให้กระเป๋าทำงาน หากเปิดบริการซื้อ Bitcoin ผู้ให้บริการภายนอกจะจัดการขั้นตอนซื้อ เงื่อนไขผู้ใช้และการตรวจสอบตัวตน (KYC) ตามข้อกำหนดของตน ปัจจุบัน GetYourSats ไม่ได้อ้างว่าสามารถซื้อให้เสร็จสิ้นในแอปได้",
      "เมื่อคุณติดต่อเรา เราประมวลผลข้อมูลที่ส่งมา ใช้แบบฟอร์มติดต่อส่วนตัวสำหรับคำถามเรื่องความเป็นส่วนตัว ข้อมูลบัญชีที่เก็บไว้ การยกเลิกการเชื่อมอีเมลหรือการลบที่อยู่ Lightning เราตรวจสอบคำขอก่อน การส่งแบบฟอร์มไม่ลบข้อมูลหรือที่อยู่อัตโนมัติ เราอาจขอหลักฐานว่าคุณควบคุมกระเป๋าที่เชื่อมไว้ แต่จะไม่ขอคำกู้คืน กุญแจส่วนตัวหรือข้อมูลรับรอง passkey",
      "การออกจากระบบ ลบข้อมูลเบราว์เซอร์หรือลบแอป ไม่ยกเลิกการเชื่อมอีเมลที่ยืนยันแล้วหรือลบที่อยู่ Lightning อัตโนมัติ การลบข้อมูลบัญชีบนเซิร์ฟเวอร์ไม่ลบธุรกรรม Bitcoin สาธารณะหรือข้อมูลที่บริการอื่นควบคุม",
      "เราอาจปรับประกาศนี้เมื่อมีบริการเพิ่มเติม ข้อความเกี่ยวกับผลิตภัณฑ์ควรตรงกับกระเป๋าที่เผยแพร่และการเชื่อมต่อบริการที่ตรวจสอบแล้ว ปรับปรุงนโยบาย: 26 ตุลาคม 2026 ปรับปรุงคำแปล: 27 ตุลาคม 2026"
    ],
    "ui": [
      "ความเป็นส่วนตัว",
      "ช่วยเหลือ",
      "เปิดกระเป๋า ↗",
      "ภาษา",
      "ในหน้านี้",
      "หน้าแรก",
      "ลบบัญชี",
      "ติดต่อทีมงาน",
      "หน้าแรก GetYourSats",
      "เมนูหลัก",
      "เมนูท้ายหน้า"
    ],
    "form": {
      "formTitle": "ติดต่อทีมงาน",
      "formIntro": "อย่าส่งคำกู้คืนหรือกุญแจส่วนตัว",
      "formName": "ชื่อ (ไม่บังคับ)",
      "formEmail": "อีเมลสำหรับตอบกลับ",
      "formTopic": "ประเภทคำถาม",
      "formMessage": "ให้เราช่วยเรื่องอะไร?",
      "formConsent": "ฉันจะไม่ส่งคำกู้คืน กุญแจส่วนตัว รหัสผ่านหรือข้อมูลรับรอง passkey",
      "formSend": "ส่งข้อความ",
      "formWait": "แบบฟอร์มยังใช้งานไม่ได้ กรุณาลองใหม่ภายหลัง",
      "formOk": "รับข้อความแล้ว หมายเลขอ้างอิง: ",
      "formErr": "ส่งไม่สำเร็จ ตรวจสอบข้อมูลแล้วลองอีกครั้ง",
      "formSending": "กำลังส่ง…",
      "topicPrompt": "เลือกประเภทคำถาม",
      "supportLimit": "เราช่วยตรวจสอบปัญหาแอปหรือการชำระเงินได้ แต่กู้คืนกุญแจ คำกู้คืนหรือกระเป๋าที่คุณดูแลเองและเข้าใช้ไม่ได้ให้ไม่ได้",
      "topics": [
        "กระเป๋าและการชำระเงิน",
        "ข้อเสนอแนะ",
        "พันธมิตร",
        "สื่อและชุมชน",
        "ความเป็นส่วนตัวและข้อมูล",
        "คำถามทั่วไป"
      ]
    }
  },
  "vi": {
    "title": "Thông báo quyền riêng tư",
    "intro": "Đây là thông báo quyền riêng tư hiện tại của GetYourSats bản beta. Thông báo giải thích thông tin được dùng trong ví và các dịch vụ tài khoản tùy chọn. Vẫn cần rà soát pháp lý cuối cùng trước khi mở rộng hoạt động thương mại.",
    "warning": "Không bao giờ gửi cho chúng tôi từ khôi phục, khóa riêng, PIN hoặc thông tin xác thực passkey. Hỗ trợ và xác minh email không cần những thông tin này. Email đã xác minh không thể khôi phục khóa ví bị mất.",
    "headings": [
      "Thông tin ví và thanh toán",
      "Thiết bị và passkey",
      "Email và địa chỉ Lightning",
      "Nhà cung cấp dịch vụ",
      "Hỗ trợ và xóa dữ liệu",
      "Cập nhật"
    ],
    "paragraphs": [
      "GetYourSats hướng tới một ví tự quản lý khóa, xây dựng bằng Breez Spark SDK. Ứng dụng và phương thức khôi phục qua thiết bị hoặc passkey bạn chọn xử lý khóa ký và thông tin khôi phục. Đơn vị vận hành Spark cùng các dịch vụ Lightning và thanh toán liên quan xử lý định danh kỹ thuật của ví, yêu cầu thanh toán và dữ liệu quyết toán để vận hành mạng. Giao dịch Bitcoin được ghi trên blockchain là công khai.",
      "Thiết bị hoặc trình quản lý mật khẩu xử lý xác thực passkey. GetYourSats không cần hình ảnh sinh trắc học hoặc PIN mở khóa thiết bị. Giữ kín các từ khôi phục của ví và không lưu trực tuyến. Ví có thể lưu trạng thái trên thiết bị để kết nối lại. Xóa dữ liệu trình duyệt hoặc PWA có thể khiến bạn mất quyền truy cập nếu không có bản sao lưu độc lập.",
      "Nếu tính năng xác minh email được bật và bạn chọn dùng, Upstash lưu email liên kết với định danh công khai của ví và thời điểm xác minh. Quy trình dùng yêu cầu được ví ký và bản ghi mã tạm thời. Yêu cầu hết hạn sau 5 phút, mã sau 10 phút. Resend gửi email. Liên kết email đã xác minh không tự hết hạn và tồn tại đến khi hoàn tất quy trình xóa được hỗ trợ. Email không dùng để đăng nhập, khôi phục ví hoặc lấy lại tiền.",
      "Khi địa chỉ Lightning cá nhân khả dụng, đăng ký hoặc đổi username@getyoursats.com qua Breez cần email đã xác minh liên kết với ví đó. Nhận tiền qua địa chỉ hiện có không cần kiểm tra email. Địa chỉ Lightning là công khai; bất kỳ ai biết địa chỉ đều có thể tra cứu.",
      "Vercel lưu trữ website và các phiên bản phát hành. Breez và Spark hỗ trợ hoạt động của ví. Nếu tính năng mua Bitcoin được bật, nhà cung cấp bên ngoài tự quản lý quy trình mua, điều kiện sử dụng và kiểm tra danh tính (KYC) theo điều khoản riêng. Hiện GetYourSats không khẳng định rằng có thể hoàn tất giao dịch mua trong ứng dụng.",
      "Khi bạn liên hệ, chúng tôi xử lý thông tin bạn gửi. Dùng biểu mẫu liên hệ riêng tư để hỏi về quyền riêng tư, thông tin tài khoản được lưu, yêu cầu hủy liên kết email hoặc xóa địa chỉ Lightning. Yêu cầu sẽ được xem xét; gửi biểu mẫu không tự động xóa bản ghi hay địa chỉ. Chúng tôi có thể yêu cầu bằng chứng bạn kiểm soát ví đã liên kết, nhưng không bao giờ yêu cầu từ khôi phục, khóa riêng hoặc thông tin xác thực passkey.",
      "Đăng xuất, xóa dữ liệu trình duyệt hoặc gỡ ứng dụng không tự hủy liên kết email đã xác minh hay xóa địa chỉ Lightning. Xóa thông tin tài khoản trên máy chủ không xóa giao dịch Bitcoin công khai hoặc bản ghi do dịch vụ khác quản lý.",
      "Chúng tôi có thể cập nhật thông báo khi có thêm dịch vụ. Thông tin giới thiệu sản phẩm cần phù hợp với ví đã phát hành và các tích hợp đã được kiểm chứng. Cập nhật chính sách: 26 tháng 10 năm 2026. Cập nhật bản dịch: 27 tháng 10 năm 2026."
    ],
    "ui": [
      "Quyền riêng tư",
      "Hỗ trợ",
      "Mở ví ↗",
      "Ngôn ngữ",
      "Trên trang này",
      "Trang chủ",
      "Xóa tài khoản",
      "Liên hệ nhóm",
      "Trang chủ GetYourSats",
      "Điều hướng chính",
      "Điều hướng cuối trang"
    ],
    "form": {
      "formTitle": "Liên hệ nhóm",
      "formIntro": "Không gửi từ khôi phục hoặc khóa riêng.",
      "formName": "Tên (không bắt buộc)",
      "formEmail": "Email nhận phản hồi",
      "formTopic": "Chủ đề",
      "formMessage": "Bạn cần hỗ trợ gì?",
      "formConsent": "Tôi sẽ không gửi từ khôi phục, khóa riêng, mật khẩu hoặc thông tin xác thực passkey.",
      "formSend": "Gửi tin nhắn",
      "formWait": "Biểu mẫu hiện chưa khả dụng. Vui lòng thử lại sau.",
      "formOk": "Đã nhận tin nhắn. Mã tham chiếu: ",
      "formErr": "Không gửi được. Hãy kiểm tra thông tin và thử lại.",
      "formSending": "Đang gửi…",
      "topicPrompt": "Chọn chủ đề",
      "supportLimit": "Chúng tôi có thể kiểm tra vấn đề về ứng dụng hoặc thanh toán, nhưng không thể khôi phục khóa, từ khôi phục hoặc ví tự quản lý mà bạn không còn truy cập được.",
      "topics": [
        "Ví và thanh toán",
        "Góp ý sản phẩm",
        "Hợp tác",
        "Truyền thông và cộng đồng",
        "Quyền riêng tư và dữ liệu",
        "Câu hỏi khác"
      ]
    }
  },
  "ta": {
    "title": "தனியுரிமை அறிவிப்பு",
    "intro": "இது GetYourSats இன் தற்போதைய பீட்டா பதிப்புக்கான தனியுரிமை அறிவிப்பு. பணப்பையும் விருப்பக் கணக்குச் சேவைகளும் பயன்படுத்தும் தகவல்களை விளக்குகிறது. பரந்த வணிக வெளியீட்டுக்கு முன் இறுதிச் சட்ட மதிப்பாய்வு இன்னும் தேவை.",
    "warning": "மீட்புச் சொற்கள், தனிப்பட்ட விசைகள், PIN அல்லது passkey சான்றுகளை எங்களுக்கு அனுப்பாதீர்கள். உதவி பெறவும் மின்னஞ்சலைச் சரிபார்க்கவும் இவை தேவையில்லை. சரிபார்க்கப்பட்ட மின்னஞ்சல் தொலைந்த பணப்பை விசைகளை மீட்டுத் தராது.",
    "headings": [
      "பணப்பை மற்றும் பணப்பரிமாற்றத் தகவல்கள்",
      "சாதனமும் passkey யும்",
      "மின்னஞ்சலும் Lightning முகவரிகளும்",
      "சேவை வழங்குநர்கள்",
      "உதவியும் தகவல் நீக்கமும்",
      "புதுப்பிப்புகள்"
    ],
    "paragraphs": [
      "GetYourSats, Breez Spark SDK மூலம் உருவாக்கப்பட்ட, பயனர் தனது விசைகளைத் தானே நிர்வகிக்கும் பணப்பையாகச் செயல்படுவதை நோக்கமாகக் கொண்டுள்ளது. கையொப்பமிடும் விசைகளையும் மீட்புத் தகவல்களையும் செயலியும் நீங்கள் தேர்ந்தெடுத்த சாதன அல்லது passkey மீட்பு முறையும் கையாளுகின்றன. வலையமைப்பை இயக்க Spark நிர்வாகிகளும் தொடர்புடைய Lightning மற்றும் பணப்பரிமாற்றச் சேவைகளும் பணப்பையின் தொழில்நுட்ப அடையாளங்கள், பணம் செலுத்தும் கோரிக்கைகள் மற்றும் பரிமாற்ற நிறைவுத் தகவல்களைப் பயன்படுத்துகின்றன. Bitcoin பிளாக்செயினில் பதிவான பரிமாற்றங்கள் பொதுவில் தெரியும்.",
      "passkey அடையாளச் சரிபார்ப்பை உங்கள் சாதனம் அல்லது கடவுச்சொல் நிர்வாகி கையாளுகிறது. GetYourSats க்கு உங்கள் உயிரளவியல் படம் அல்லது சாதனத்தைத் திறக்கும் PIN தேவையில்லை. உங்கள் பணப்பையின் மீட்புச் சொற்களை ரகசியமாக, இணையத்தில் சேமிக்காமல் பாதுகாக்கவும். மீண்டும் இணைவதற்காக பணப்பை சாதனத்தில் சில தகவல்களைச் சேமிக்கலாம். தனியான காப்புப் பிரதி இல்லாமல் உலாவி அல்லது PWA தரவை அழித்தால் பணப்பையை அணுக முடியாமல் போகலாம்.",
      "மின்னஞ்சல் சரிபார்ப்பு கிடைக்கும்போது அதை நீங்கள் தேர்ந்தெடுத்தால், உங்கள் மின்னஞ்சலை பணப்பையின் பொது அடையாளத்துடனும் சரிபார்த்த நேரத்துடனும் Upstash சேமிக்கும். பணப்பை கையொப்பமிட்ட கோரிக்கைகளும் தற்காலிகக் குறியீட்டுப் பதிவுகளும் பயன்படுத்தப்படும். கோரிக்கைகள் 5 நிமிடங்களிலும் குறியீடுகள் 10 நிமிடங்களிலும் காலாவதியாகும். Resend மின்னஞ்சல்களை அனுப்புகிறது. சரிபார்க்கப்பட்ட மின்னஞ்சல் இணைப்பு தானாகக் காலாவதியாகாது; ஆதரிக்கப்படும் நீக்க நடைமுறை முடியும் வரை இருக்கும். மின்னஞ்சலால் பணப்பையில் உள்நுழையவோ பணப்பை அல்லது பணத்தை மீட்கவோ முடியாது.",
      "தனிப்பயன் Lightning முகவரிகள் கிடைக்கும்போது, Breez மூலம் username@getyoursats.com ஐப் பதிவு செய்ய அல்லது மாற்ற அதே பணப்பையுடன் இணைக்கப்பட்ட சரிபார்க்கப்பட்ட மின்னஞ்சல் தேவை. ஏற்கெனவே உள்ள முகவரியில் பணம் பெற மின்னஞ்சல் சோதனை தேவையில்லை. Lightning முகவரி பொதுவானது; அதை அறிந்த எவரும் தேடிப் பார்க்கலாம்.",
      "Vercel இணையதளத்தையும் வெளியிடப்பட்ட பதிப்புகளையும் வழங்குகிறது. Breez மற்றும் Spark சேவைகள் பணப்பையின் செயல்பாட்டுக்கு உதவுகின்றன. Bitcoin வாங்கும் வசதி செயல்படுத்தப்பட்டால், வெளிச் சேவை வழங்குநர் தனது விதிகளின் கீழ் வாங்கும் நடைமுறை, தகுதி மற்றும் அடையாளச் சரிபார்ப்பை (KYC) நிர்வகிப்பார். தற்போது செயலிக்குள் வாங்குவதை முடிக்க முடியும் என்று GetYourSats கூறவில்லை.",
      "நீங்கள் தொடர்புகொள்ளும்போது அனுப்பும் தகவல்களை நாங்கள் பயன்படுத்துகிறோம். தனியுரிமை, சேமிக்கப்பட்ட கணக்குத் தகவல்கள், மின்னஞ்சல் இணைப்பை நீக்குதல் அல்லது Lightning முகவரியை நீக்குதல் தொடர்பாக தனிப்பட்ட தொடர்புப் படிவத்தைப் பயன்படுத்தவும். கோரிக்கைகள் பரிசீலிக்கப்படும்; படிவத்தை அனுப்புவது பதிவுகளையோ முகவரியையோ தானாக நீக்காது. இணைக்கப்பட்ட பணப்பை உங்கள் கட்டுப்பாட்டில் இருப்பதற்கான சான்றைக் கேட்கலாம். மீட்புச் சொற்கள், தனிப்பட்ட விசைகள் அல்லது passkey சான்றுகளை ஒருபோதும் கேட்க மாட்டோம்.",
      "வெளியேறுதல், உலாவித் தரவை அழித்தல் அல்லது செயலியை நீக்குதல் ஆகியவை சரிபார்க்கப்பட்ட மின்னஞ்சல் இணைப்பையோ Lightning முகவரியையோ தானாக நீக்காது. சேவையகத்தில் உள்ள கணக்குத் தகவல்களை நீக்குவது பொது Bitcoin பரிமாற்றங்களையோ பிற சேவைகள் கட்டுப்படுத்தும் பதிவுகளையோ அழிக்காது.",
      "புதிய சேவைகள் கிடைக்கும்போது இந்த அறிவிப்பு மாறலாம். தயாரிப்பு பற்றிய விளக்கங்கள் வெளியிடப்பட்ட பணப்பைக்கும் சரிபார்க்கப்பட்ட இணைப்புகளுக்கும் பொருந்த வேண்டும். கொள்கை புதுப்பிப்பு: 26 அக்டோபர் 2026. மொழிபெயர்ப்பு புதுப்பிப்பு: 27 அக்டோபர் 2026."
    ],
    "ui": [
      "தனியுரிமை",
      "உதவி",
      "பணப்பையைத் திறக்கவும் ↗",
      "மொழி",
      "இந்தப் பக்கத்தில்",
      "முகப்பு",
      "கணக்கை நீக்குதல்",
      "குழுவைத் தொடர்புகொள்ளவும்",
      "GetYourSats முகப்புப் பக்கம்",
      "முதன்மை வழிசெலுத்தல்",
      "அடிக்குறிப்பு வழிசெலுத்தல்"
    ],
    "form": {
      "formTitle": "குழுவைத் தொடர்புகொள்ளவும்",
      "formIntro": "மீட்புச் சொற்கள் அல்லது தனிப்பட்ட விசைகளை அனுப்பாதீர்கள்.",
      "formName": "பெயர் (விருப்பம்)",
      "formEmail": "பதில் பெறும் மின்னஞ்சல்",
      "formTopic": "கேள்வியின் வகை",
      "formMessage": "என்ன உதவி தேவை?",
      "formConsent": "மீட்புச் சொற்கள், தனிப்பட்ட விசைகள், கடவுச்சொற்கள் அல்லது passkey சான்றுகளை அனுப்ப மாட்டேன்.",
      "formSend": "செய்தியை அனுப்பவும்",
      "formWait": "படிவம் தற்போது கிடைக்கவில்லை. சிறிது நேரம் கழித்து முயலவும்.",
      "formOk": "செய்தி பெறப்பட்டது. குறிப்பு எண்: ",
      "formErr": "அனுப்ப முடியவில்லை. தகவல்களைச் சரிபார்த்து மீண்டும் முயலவும்.",
      "formSending": "அனுப்பப்படுகிறது…",
      "topicPrompt": "கேள்வியின் வகையைத் தேர்ந்தெடுக்கவும்",
      "supportLimit": "செயலி அல்லது பணப்பரிமாற்றப் பிரச்சினைகளை ஆராய முடியும். தொலைந்த விசைகள், மீட்புச் சொற்கள் அல்லது அணுக முடியாத சுயநிர்வாகப் பணப்பைகளை மீட்டுத் தர முடியாது.",
      "topics": [
        "பணப்பையும் பணப்பரிமாற்றமும்",
        "தயாரிப்புக் கருத்துகள்",
        "கூட்டாண்மை",
        "ஊடகமும் சமூகமும்",
        "தனியுரிமையும் தகவல்களும்",
        "பொதுக் கேள்வி"
      ]
    }
  },
  "ar": {
    "title": "إشعار الخصوصية",
    "intro": "هذا إشعار الخصوصية الحالي لإصدار GetYourSats التجريبي. يوضح المعلومات التي تستخدمها المحفظة وخدمات الحساب الاختيارية. لا تزال المراجعة القانونية النهائية مطلوبة قبل إطلاق تجاري أوسع.",
    "warning": "لا ترسل إلينا كلمات الاسترداد أو المفاتيح الخاصة أو PIN أو بيانات اعتماد passkey. لا نحتاج إليها للدعم أو للتحقق من البريد الإلكتروني. البريد المتحقق منه لا يستعيد مفاتيح المحفظة المفقودة.",
    "headings": [
      "معلومات المحفظة والمدفوعات",
      "الجهاز وpasskey",
      "البريد وعناوين Lightning",
      "مقدمو الخدمات",
      "الدعم وحذف البيانات",
      "التحديثات"
    ],
    "paragraphs": [
      "صُممت GetYourSats لتكون محفظة يدير المستخدم مفاتيحها، باستخدام Breez Spark SDK. يتولى التطبيق وطريقة الاسترداد التي تختارها عبر الجهاز أو passkey التعامل مع مفاتيح التوقيع ومعلومات الاسترداد. يعالج مشغلو Spark وخدمات Lightning والدفع المرتبطة بها المعرّفات التقنية للمحفظة وطلبات الدفع وبيانات التسوية لتشغيل الشبكة. معاملات Bitcoin المسجلة على سلسلة الكتل علنية.",
      "يدير جهازك أو مدير كلمات المرور المصادقة باستخدام passkey. لا تحتاج GetYourSats إلى صورتك البيومترية أو PIN فتح الجهاز. احتفظ بكلمات استرداد محفظتك بشكل خاص وخارج الإنترنت. قد تحتفظ المحفظة ببيانات محلية لإعادة الاتصال. قد يؤدي مسح بيانات المتصفح أو PWA إلى فقدان الوصول إن لم تكن لديك نسخة احتياطية مستقلة.",
      "إذا كان التحقق من البريد متاحًا واخترت استخدامه، تخزن Upstash بريدك المرتبط بالهوية العامة لمحفظتك ووقت التحقق. تستخدم العملية طلبات موقعة من المحفظة وسجلات مؤقتة للرموز. تنتهي صلاحية الطلبات بعد 5 دقائق والرموز بعد 10 دقائق. ترسل Resend رسائل البريد. لا ينتهي ربط البريد المتحقق منه تلقائيًا، بل يبقى حتى اكتمال إجراء إزالة مدعوم. البريد ليس وسيلة لتسجيل الدخول إلى المحفظة أو استردادها أو استعادة الأموال.",
      "عند إتاحة عناوين Lightning المخصصة، يتطلب تسجيل username@getyoursats.com أو تغييره عبر Breez بريدًا متحققًا منه مرتبطًا بالمحفظة نفسها. لا يتطلب تلقي الأموال عبر عنوان موجود التحقق من البريد. عنوان Lightning علني، ويمكن لأي شخص يعرفه الاستعلام عنه.",
      "تستضيف Vercel الموقع والإصدارات المنشورة. تدعم خدمات Breez وSpark عمل المحفظة. إذا أُتيحت خدمة شراء Bitcoin، يدير مقدم الخدمة الخارجي إجراءات الشراء والأهلية والتحقق من الهوية (KYC) وفق شروطه الخاصة. لا تدّعي GetYourSats حاليًا إمكانية إتمام الشراء داخل التطبيق.",
      "عندما تتواصل معنا، نعالج المعلومات التي ترسلها. استخدم نموذج التواصل الخاص للاستفسار عن الخصوصية أو بيانات الحساب المخزنة أو طلب فصل البريد أو إزالة عنوان Lightning. تخضع الطلبات للمراجعة؛ إرسال النموذج لا يحذف السجلات أو العنوان تلقائيًا. قد نطلب إثبات تحكمك بالمحفظة المرتبطة، لكننا لن نطلب كلمات الاسترداد أو المفاتيح الخاصة أو بيانات اعتماد passkey.",
      "لا يؤدي تسجيل الخروج أو مسح بيانات المتصفح أو حذف التطبيق تلقائيًا إلى فصل بريد متحقق منه أو إزالة عنوان Lightning. حذف معلومات الحساب من الخادم لا يمحو معاملات Bitcoin العلنية أو سجلات تتحكم بها خدمات أخرى.",
      "قد نحدّث هذا الإشعار عند إتاحة خدمات إضافية. ينبغي أن تعكس أوصاف المنتج المحفظة المنشورة والتكاملات التي تم التحقق منها. تحديث السياسة: 26 أكتوبر 2026. تحديث الترجمة: 27 أكتوبر 2026."
    ],
    "ui": [
      "الخصوصية",
      "الدعم",
      "فتح المحفظة ↗",
      "اللغة",
      "في هذه الصفحة",
      "الرئيسية",
      "إزالة الحساب",
      "التواصل مع الفريق",
      "صفحة GetYourSats الرئيسية",
      "التنقل الرئيسي",
      "روابط أسفل الصفحة"
    ],
    "form": {
      "formTitle": "التواصل مع الفريق",
      "formIntro": "لا ترسل كلمات الاسترداد أو المفاتيح الخاصة.",
      "formName": "الاسم (اختياري)",
      "formEmail": "بريد الرد",
      "formTopic": "نوع الاستفسار",
      "formMessage": "كيف يمكننا مساعدتك؟",
      "formConsent": "لن أرسل كلمات الاسترداد أو المفاتيح الخاصة أو كلمات المرور أو بيانات اعتماد passkey.",
      "formSend": "إرسال الرسالة",
      "formWait": "النموذج غير متاح حاليًا. يرجى المحاولة لاحقًا.",
      "formOk": "تم قبول الرسالة. الرقم المرجعي: ",
      "formErr": "تعذر الإرسال. راجع البيانات وحاول مجددًا.",
      "formSending": "جارٍ الإرسال…",
      "topicPrompt": "اختر نوع الاستفسار",
      "supportLimit": "يمكننا التحقيق في مشكلات التطبيق أو المدفوعات. لا يمكننا استعادة مفاتيح أو كلمات استرداد مفقودة أو محافظ يديرها المستخدم وتعذر الوصول إليها.",
      "topics": [
        "المحفظة والمدفوعات",
        "ملاحظات المنتج",
        "الشراكات",
        "الإعلام والمجتمع",
        "الخصوصية والبيانات",
        "استفسار عام"
      ]
    }
  },
  "zh-CN": {
    "title": "隐私声明",
    "intro": "这是GetYourSats当前测试版的隐私声明，说明钱包和可选账户服务使用哪些信息。在扩大商业发布前，仍需完成最终法律审查。",
    "warning": "请勿向我们提供恢复词、私钥、PIN或passkey凭据。客服和邮箱验证不需要这些信息。已验证的邮箱不能找回丢失的钱包密钥。",
    "headings": [
      "钱包与支付信息",
      "设备与passkey",
      "邮箱与Lightning地址",
      "服务提供方",
      "支持与数据删除",
      "更新"
    ],
    "paragraphs": [
      "GetYourSats旨在成为使用Breez Spark SDK构建的自托管钱包。应用和你选择的设备或passkey恢复方式负责处理签名密钥与恢复信息。为运行网络，Spark运营方及相关Lightning和支付服务会处理钱包技术标识、付款请求和结算数据。记录在Bitcoin区块链上的交易是公开的。",
      "passkey验证由你的设备或密码管理器负责。GetYourSats不需要你的生物识别图像或设备解锁PIN。请将钱包的恢复词保密并离线保存。钱包可能在设备上保存状态以便重新连接。如果没有独立备份，清除浏览器或PWA数据可能导致无法访问钱包。",
      "如果邮箱验证可用且你选择使用，Upstash会保存与你的钱包公开标识关联的邮箱和验证时间。验证过程使用钱包签名的确认请求及临时验证码记录。请求在5分钟后过期，验证码在10分钟后过期。Resend负责发送邮件。已验证的邮箱关联不会自动过期，会保留至受支持的移除流程完成。邮箱不能用于登录钱包、恢复钱包或找回资金。",
      "个性化Lightning地址可用时，通过Breez注册或更改username@getyoursats.com需要使用与该钱包关联的已验证邮箱。通过已有地址收款不需要检查邮箱。Lightning地址是公开的，任何知道该地址的人都可以查询。",
      "Vercel托管网站和发布版本。Breez和Spark服务支持钱包运行。如果启用Bitcoin购买服务，第三方提供商将依照自己的条款处理购买流程、资格要求和身份核验（KYC）。GetYourSats目前不宣称可以在应用内完成购买。",
      "当你联系我们时，我们会处理你提交的信息。有关隐私、已保存的账户信息、解绑邮箱或注销Lightning地址的请求，请使用私密联系表单。请求需要审核；提交表单不会自动删除记录或注销地址。我们可能要求你证明对关联钱包的控制权，但绝不会索要恢复词、私钥或passkey凭据。",
      "退出登录、清除浏览器数据或删除应用，不会自动解绑已验证的邮箱或注销Lightning地址。删除服务器上的账户信息，不会抹除公开的Bitcoin交易或由其他服务控制的记录。",
      "我们可能随着新服务上线更新本声明。产品说明应符合已发布钱包和经过验证的集成功能。政策更新：2026年10月26日。翻译更新：2026年10月27日。"
    ],
    "ui": [
      "隐私",
      "支持",
      "打开钱包 ↗",
      "语言",
      "本页内容",
      "首页",
      "移除账户",
      "联系团队",
      "GetYourSats首页",
      "主导航",
      "页脚导航"
    ],
    "form": {
      "formTitle": "联系团队",
      "formIntro": "请勿发送恢复词或私钥。",
      "formName": "姓名（可选）",
      "formEmail": "接收回复的邮箱",
      "formTopic": "咨询类型",
      "formMessage": "需要什么帮助？",
      "formConsent": "我不会提交恢复词、私钥、密码或passkey凭据。",
      "formSend": "发送消息",
      "formWait": "表单暂不可用，请稍后重试。",
      "formOk": "消息已接收。参考编号：",
      "formErr": "发送失败，请检查填写内容后重试。",
      "formSending": "正在发送…",
      "topicPrompt": "选择咨询类型",
      "supportLimit": "我们可以调查应用或支付问题，但无法找回丢失的密钥、恢复词或无法访问的自托管钱包。",
      "topics": [
        "钱包与支付",
        "产品反馈",
        "合作",
        "媒体与社区",
        "隐私与数据",
        "一般咨询"
      ]
    }
  }
};
