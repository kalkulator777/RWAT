package com.muzhik17.trainsmod.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.List;

import org.joml.Vector3d;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.network.RiderLocal;

/**
 * Feet belong to the car whose frame they are in (SPEC §9.5, the gangway
 * jolt): a rider a gangway carried on is placed by the server's start spot on
 * the new car, never by the old car's feet read in the new car's frame.
 */
class ClientWalkTest {

    private static final int ME = 42;
    private static final int OLD_CAR = 10;
    private static final int NEW_CAR = 11;

    @BeforeEach
    void reset() {
        ClientWalk.clearAll();
        ClientRiderSync.clearAll();
    }

    @Test
    void feetOnAnotherCar_placeNobodyHere() {
        ClientWalk.setLocalOwner(ME);
        ClientWalk.put(ME, OLD_CAR, new Vector3d(0.0, 1.81, 11.45));
        assertEquals(11.45, ClientWalk.on(ME, OLD_CAR).z, 1.0e-9);
        assertNull(ClientWalk.on(ME, NEW_CAR));
    }

    @Test
    void theServersStartSpot_placesTheLocalPlayerOnTheNewCar() {
        ClientWalk.setLocalOwner(ME);
        ClientWalk.put(ME, OLD_CAR, new Vector3d(0.0, 1.81, 11.45));
        ClientWalk.place(NEW_CAR, new Vector3d(0.0, 1.81, -11.40));
        // until the passenger change comes, the old car still has them where they were
        assertEquals(11.45, ClientWalk.on(ME, OLD_CAR).z, 1.0e-9);
        assertEquals(-11.40, ClientWalk.on(ME, NEW_CAR).z, 1.0e-9);
        // the prediction takes the spot over
        Vector3d placed = ClientWalk.takePlacement(NEW_CAR);
        ClientWalk.put(ME, NEW_CAR, placed);
        assertEquals(-11.40, ClientWalk.on(ME, NEW_CAR).z, 1.0e-9);
        assertNull(ClientWalk.on(ME, OLD_CAR));
    }

    @Test
    void anObservedRider_isPlacedOnlyOnTheCarTheSyncNamed() {
        ClientRiderSync.apply(1, List.of(new RiderLocal(7, NEW_CAR, 0.0, 1.81, -11.40)));
        assertNull(ClientWalk.on(7, OLD_CAR));
        assertEquals(-11.40, ClientWalk.on(7, NEW_CAR).z, 1.0e-9);
    }

    @Test
    void theServersFeetForTheLocalPlayer_areKeptAsideForTheDriftCheck() {
        ClientWalk.setLocalOwner(ME);
        ClientWalk.put(ME, OLD_CAR, new Vector3d(0.0, 1.81, 3.0));
        ClientRiderSync.apply(1, List.of(new RiderLocal(ME, OLD_CAR, 0.0, 1.81, 5.5)));
        // the prediction places them …
        assertEquals(3.0, ClientWalk.on(ME, OLD_CAR).z, 1.0e-9);
        // … the server's feet are there to compare, once
        ClientWalk.Feet server = ClientWalk.takeServerFeet();
        assertEquals(OLD_CAR, server.wagonId());
        assertEquals(5.5, server.local().z, 1.0e-9);
        assertNull(ClientWalk.takeServerFeet());
    }

    @Test
    void feetOfNoKnownCar_fitAnyCar() {
        ClientWalk.put(ME, new Vector3d(0.5, 1.81, 3.0));
        assertEquals(3.0, ClientWalk.on(ME, OLD_CAR).z, 1.0e-9);
    }
}
