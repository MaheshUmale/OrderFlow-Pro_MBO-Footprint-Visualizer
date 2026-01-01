package com.example.upstoxbridge;

import com.google.gson.Gson;
import com.upstox.ApiClient;
import com.upstox.ApiException;
import com.upstox.Configuration;
import com.upstox.auth.OAuth;
import com.upstox.feeder.MarketDataStreamerV3;
import com.upstox.feeder.MarketUpdateV3;
import com.upstox.feeder.constants.Mode;
import com.upstox.feeder.listener.OnMarketUpdateV3Listener;
import io.swagger.client.api.OptionsApi;
import com.upstox.api.GetOptionContractResponse;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.function.Consumer;

@Service
public class UpstoxService {

    private MarketDataStreamerV3 marketDataStreamer;
    private final Gson gson = new Gson();
    private ApiClient defaultClient;

    public void connect(String accessToken, Consumer<String> onMarketUpdate) {
        if (marketDataStreamer != null) {
            marketDataStreamer.disconnect();
        }

        defaultClient = Configuration.getDefaultApiClient();
        OAuth oAuth = (OAuth) defaultClient.getAuthentication("OAUTH2");
        oAuth.setAccessToken(accessToken);

        Set<String> instrumentKeys = new HashSet<>();
        instrumentKeys.add("NSE_INDEX|Nifty 50");
        instrumentKeys.add("NSE_INDEX|Nifty Bank");

        marketDataStreamer = new MarketDataStreamerV3(defaultClient, instrumentKeys, Mode.FULL);

        marketDataStreamer.setOnMarketUpdateListener(new OnMarketUpdateV3Listener() {
            @Override
            public void onUpdate(MarketUpdateV3 marketUpdate) {
                onMarketUpdate.accept(gson.toJson(marketUpdate));
            }
        });

        marketDataStreamer.connect();
    }

    public String getOptionChain(String instrumentKey) throws ApiException {
        OptionsApi optionsApi = new OptionsApi(defaultClient);
        GetOptionContractResponse response = optionsApi.getOptionContracts(instrumentKey, null);
        return gson.toJson(response.getData());
    }

    public String getLtpQuote(String instrumentKey) throws ApiException {
        return "{}";
    }
}
