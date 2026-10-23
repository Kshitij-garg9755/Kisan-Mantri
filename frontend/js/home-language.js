(() => {
  const translations = {
    hi: {
      brandSub:'आपका खेती साथी', eyebrow:'आपका किसान साथी', greeting:'नमस्ते किसान', welcome:'आज खेती में किस काम की मदद चाहिए?',
      weatherTitle:'आज का मौसम', weatherText:'बारिश और तापमान देखें', quickTitle:'आज का काम चुनें', quickHint:'जिस काम में मदद चाहिए, उसे दबाएँ',
      sell:'फसल बेचें', sellHint:'भाव देखें और खरीदार पाएँ', crop:'फसल की बीमारी', cropHint:'फोटो से समस्या पहचानें', schemes:'सरकारी मदद', schemesHint:'योजना और सहायता देखें', land:'खेत नापें', landHint:'खेत का रकबा पता करें',
      marketTitle:'अपनी फसल चुनें', marketHint:'बाज़ार में क्या ढूँढ़ना है?', allMarket:'पूरा बाज़ार', vegetables:'सब्ज़ियाँ', vegetablesHint:'ताज़ी सब्ज़ियाँ देखें', grains:'अनाज और दालें', grainsHint:'अनाज और दालें देखें',
      communityTitle:'किसानों से जुड़ें', communityHint:'सीखें, पूछें और बात करें', chaupal:'किसान चौपाल', chaupalHint:'दूसरे किसानों से सवाल पूछें', radio:'खेती की आवाज़', radioHint:'खेती की बातें सुनें', fieldInfo:'खेत की जानकारी', fieldInfoHint:'अपने खेत और फसल को समझें', footer:'किसानों की मदद के लिए बनाया गया',
      navHome:'होम', navMarket:'बाज़ार', navWeather:'मौसम', navChaupal:'चौपाल', navMore:'और'
    },
    en: {
      brandSub:'Your farming companion', eyebrow:'YOUR FARMING COMPANION', greeting:'Hello, farmer', welcome:'What would you like help with today?',
      weatherTitle:'Today’s weather', weatherText:'Check rain and temperature', quickTitle:'Choose a task', quickHint:'Tap what you need help with',
      sell:'Sell your crop', sellHint:'Check prices and find buyers', crop:'Crop problem', cropHint:'Identify an issue from a photo', schemes:'Government support', schemesHint:'Explore schemes and assistance', land:'Measure your field', landHint:'Find your field area',
      marketTitle:'Choose your crop', marketHint:'What are you looking for?', allMarket:'Open marketplace', vegetables:'Vegetables', vegetablesHint:'Browse fresh vegetables', grains:'Grains and pulses', grainsHint:'Browse grains and pulses',
      communityTitle:'Connect with farmers', communityHint:'Learn, ask questions and talk', chaupal:'Farmers’ meeting place', chaupalHint:'Ask other farmers a question', radio:'Farming radio', radioHint:'Listen to farming stories', fieldInfo:'Field information', fieldInfoHint:'Learn about your field and crop', footer:'Made to help farmers',
      navHome:'Home', navMarket:'Market', navWeather:'Weather', navChaupal:'Chaupal', navMore:'More'
    }
  };
  const menuNames = {
    'Home':'Home','Marketplace':'Marketplace','My Cart':'My Cart','Weather':'Weather','Kisan Chaupal':'Kisan Chaupal','Government Schemes':'Government Schemes','Kisan Bank':'Kisan Bank','Kisan Radio':'Kisan Radio','Satellite AI':'Satellite AI','Crop Diagnosis':'Crop Diagnosis','Land Measurement':'Land Measurement','AgriVerse':'AgriVerse','Farmer Login':'Farmer Login'
  };
  const menuHindi = ['होम','बाज़ार','मेरी टोकरी','मौसम','किसान चौपाल','सरकारी योजनाएँ','किसान बैंक','खेती की आवाज़','खेत की जानकारी','फसल की बीमारी','खेत नापें','किसान समुदाय','किसान लॉगिन'];
  const button = document.getElementById('language-toggle');
  const safeGet = () => { try { return localStorage.getItem('kisan-language'); } catch (_) { return null; } };
  const safeSet = value => { try { localStorage.setItem('kisan-language', value); } catch (_) {} };
  let language = safeGet() === 'en' ? 'en' : 'hi';
  function applyLanguage(next) {
    language = next;
    document.documentElement.lang = next;
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const value = translations[next][el.dataset.i18n];
      if (value) el.textContent = value;
    });
    if (button) {
      button.textContent = next === 'hi' ? 'English' : 'हिंदी';
      button.setAttribute('aria-label', next === 'hi' ? 'Switch to English' : 'हिंदी में बदलें');
    }
    document.querySelectorAll('.app-menu-panel a').forEach((link, index) => {
      link.textContent = next === 'hi' ? (menuHindi[index] || link.textContent) : (Object.keys(menuNames)[index] || link.textContent);
    });
    safeSet(next);
  }
  button?.addEventListener('click', () => applyLanguage(language === 'hi' ? 'en' : 'hi'));
  applyLanguage(language);
})();
