package com.kisanmantri.app;

import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
	@Override
	@SuppressWarnings("deprecation")
	public void onBackPressed() {
		if (bridge == null || bridge.getWebView() == null) {
			finish();
			return;
		}

		WebView webView = bridge.getWebView();
		String closeDialogScript = "(function(){"
			+ "const dialogs=[...document.querySelectorAll('[role=\\\"dialog\\\"],[aria-modal=\\\"true\\\"],.modal,#helpline-popup')];"
			+ "const dialog=dialogs.find(function(el){const style=getComputedStyle(el);"
			+ "return !el.hidden&&el.getAttribute('aria-hidden')!=='true'&&"
			+ "style.display!=='none'&&style.visibility!=='hidden';});"
			+ "if(!dialog)return false;"
			+ "if(dialog.id==='helpline-popup'){dialog.style.display='none';return true;}"
			+ "const close=dialog.querySelector('#close-land-model,#modal-close,"
			+ "[data-bs-dismiss=\\\"modal\\\"],[aria-label*=\\\"close\\\" i]');"
			+ "if(!close)return false;close.click();return true;})()";

		webView.evaluateJavascript(closeDialogScript, result -> {
			if (!"true".equals(result)) {
				if (webView.canGoBack()) {
					webView.goBack();
				} else {
					finish();
				}
			}
		});
	}
}
