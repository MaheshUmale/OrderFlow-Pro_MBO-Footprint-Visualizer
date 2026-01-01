package com.example.upstoxbridge;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.upstox.ApiException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.util.ArrayList;
import java.util.List;

@Component
public class WebSocketHandler extends TextWebSocketHandler {

    @Autowired
    private UpstoxService upstoxService;

    private WebSocketSession session;
    private final Gson gson = new Gson();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        System.out.println("Frontend Connected: " + session.getId());
        this.session = session;
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        System.out.println("Received message: " + message.getPayload());
        JsonObject jsonObject = gson.fromJson(message.getPayload(), JsonObject.class);
        String type = jsonObject.get("type").getAsString();

        switch (type) {
            case "init":
                String token = jsonObject.get("token").getAsString();
                upstoxService.connect(token, this::sendToFrontend);
                break;
            case "subscribe":
                // Handle subscription logic here
                break;
            case "get_option_chain":
                String instrumentKey = jsonObject.get("instrumentKey").getAsString();
                try {
                    String optionChain = upstoxService.getOptionChain(instrumentKey);
                    JsonObject response = new JsonObject();
                    response.addProperty("type", "option_chain_response");
                    response.add("data", gson.fromJson(optionChain, JsonElement.class));
                    response.addProperty("underlyingKey", instrumentKey);
                    sendToFrontend(response.toString());
                } catch (ApiException e) {
                    sendErrorToFrontend("Upstox API Error: " + e.getMessage());
                }
                break;
            case "get_quotes":
                JsonArray instrumentKeysJson = jsonObject.getAsJsonArray("instrumentKeys");
                List<String> instrumentKeys = new ArrayList<>();
                for (JsonElement element : instrumentKeysJson) {
                    instrumentKeys.add(element.getAsString());
                }
                String keys = String.join(",", instrumentKeys);
                try {
                    String quotes = upstoxService.getLtpQuote(keys);
                    JsonObject response = new JsonObject();
                    response.addProperty("type", "quote_response");
                    response.add("data", gson.fromJson(quotes, JsonElement.class));
                    sendToFrontend(response.toString());
                } catch (ApiException e) {
                    sendErrorToFrontend("Upstox API Error: " + e.getMessage());
                }
                break;
        }
    }

    public void sendToFrontend(String message) {
        if (session != null && session.isOpen()) {
            try {
                session.sendMessage(new TextMessage(message));
            } catch (Exception e) {
                System.err.println("Error sending message to frontend: " + e.getMessage());
            }
        }
    }

    public void sendErrorToFrontend(String errorMessage) {
        if (session != null && session.isOpen()) {
            try {
                JsonObject errorObject = new JsonObject();
                errorObject.addProperty("type", "error");
                errorObject.addProperty("message", errorMessage);
                session.sendMessage(new TextMessage(errorObject.toString()));
            } catch (Exception e) {
                System.err.println("Error sending error message to frontend: " + e.getMessage());
            }
        }
    }
}
