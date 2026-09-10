package com.photoalbum.controller;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.Map;
import javax.sql.DataSource;

import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class HealthControllerTests {

    @Test
    void reportsDatabaseReadinessAndClosesConnection() throws SQLException {
        DataSource source = mock(DataSource.class);
        Connection connection = mock(Connection.class);
        when(source.getConnection()).thenReturn(connection);
        when(connection.isValid(2)).thenReturn(true);

        ResponseEntity<Map<String, String>> response = new HealthController(source).health();

        assertEquals(200, response.getStatusCode().value());
        assertEquals("ok", response.getBody().get("status"));
        assertEquals("no-store", response.getHeaders().getCacheControl());
        verify(connection).close();
    }

    @Test
    void invalidConnectionIsNotHealthy() throws SQLException {
        DataSource source = mock(DataSource.class);
        Connection connection = mock(Connection.class);
        when(source.getConnection()).thenReturn(connection);
        when(connection.isValid(2)).thenReturn(false);

        ResponseEntity<Map<String, String>> response = new HealthController(source).health();

        assertEquals(503, response.getStatusCode().value());
        assertEquals("unhealthy", response.getBody().get("status"));
        verify(connection).close();
    }

    @Test
    void databaseFailureDoesNotDiscloseConnectionDetails() throws SQLException {
        DataSource source = mock(DataSource.class);
        when(source.getConnection()).thenThrow(new SQLException("connection details must stay private"));

        ResponseEntity<Map<String, String>> response = new HealthController(source).health();

        assertEquals(503, response.getStatusCode().value());
        assertEquals(1, response.getBody().size());
        assertEquals("unhealthy", response.getBody().get("status"));
    }
}
