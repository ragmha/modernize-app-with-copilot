package com.photoalbum.controller;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.Collections;
import java.util.Map;
import javax.sql.DataSource;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {

    private final DataSource dataSource;

    public HealthController(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @GetMapping("/health")
    public ResponseEntity<Map<String, String>> health() {
        boolean ready = false;
        try (Connection connection = dataSource.getConnection()) {
            ready = connection.isValid(2);
        } catch (SQLException ignored) {
            // Readiness must not disclose database credentials or exception details.
        }
        return ResponseEntity.status(ready ? 200 : 503)
                .cacheControl(CacheControl.noStore())
                .body(Collections.singletonMap("status", ready ? "ok" : "unhealthy"));
    }
}
