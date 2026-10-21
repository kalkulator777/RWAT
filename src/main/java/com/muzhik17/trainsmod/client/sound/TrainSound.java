package com.muzhik17.trainsmod.client.sound;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;

import net.minecraft.client.Minecraft;
import net.minecraft.client.resources.sounds.AbstractTickableSoundInstance;
import net.minecraft.client.resources.sounds.Sound;
import net.minecraft.client.resources.sounds.SoundInstance;
import net.minecraft.client.sounds.SoundManager;
import net.minecraft.client.sounds.WeighedSoundEvents;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.sounds.SoundSource;
import net.minecraft.util.valueproviders.ConstantFloat;
import net.minecraft.world.phys.Vec3;

/**
 * One playing train sound (SPEC §10): a pack's Ogg file (or a sound event)
 * at a point in the world, its volume, pitch and position set by
 * {@link TrainSounds} every tick. A file plays straight from its path — no
 * {@code sounds.json} entry needed, the declaration is the registration —
 * with its own hearing distance (a horn carries further than the wheels); a
 * sound event plays its own file, but carries as far as a file would.
 * OpenAL places only mono sounds in the world: a stereo file would sound as
 * loud at the far end of the hearing distance as next to it, so its volume
 * falls off with distance here instead (MVP's wheels, joints and doors are
 * stereo; its files stay byte for byte — CC BY-NC-ND).
 */
final class TrainSound extends AbstractTickableSoundInstance {

    private final boolean file;
    private final int distance;
    private final boolean stereo;

    private TrainSound(ResourceLocation location, boolean file, boolean looping, int distance,
            boolean stereo) {
        super(SoundEvent.createVariableRangeEvent(location), SoundSource.NEUTRAL,
                SoundInstance.createUnseededRandom());
        this.file = file;
        this.distance = distance;
        this.stereo = stereo;
        this.looping = looping;
        this.delay = 0;
        this.attenuation = SoundInstance.Attenuation.LINEAR;
    }

    /**
     * A sound from a declaration reference ({@code ns:path.ogg} or a sound
     * event id), heard up to {@code distance} blocks; null if the reference
     * isn't a valid resource location (logged once by the caller's parse).
     */
    static TrainSound of(String ref, boolean looping, int distance) {
        ResourceLocation location = ResourceLocation.tryParse(ref);
        if (location == null) {
            RailsWheelsAndTrains.LOGGER.warn("Bad train sound reference '{}'", ref);
            return null;
        }
        boolean file = SoundSet.isFile(ref);
        return new TrainSound(location, file, looping, distance, file && SoundInfo.stereo(ref));
    }

    @Override
    public WeighedSoundEvents resolve(SoundManager manager) {
        if (!file) {
            WeighedSoundEvents events = super.resolve(manager); // a registered sound event
            if (sound != SoundManager.EMPTY_SOUND && sound != SoundManager.INTENTIONALLY_EMPTY_SOUND) {
                // its own file and levels, our distance (sounds.json's default is 16 blocks)
                sound = new Sound(sound.getLocation(), sound.getVolume(), sound.getPitch(), sound.getWeight(),
                        sound.getType(), sound.shouldStream(), sound.shouldPreload(), distance);
            }
            return events;
        }
        this.sound = new FileSound(location, distance);
        WeighedSoundEvents events = new WeighedSoundEvents(location, null);
        events.addSound(this.sound);
        return events;
    }

    /** A stereo file's volume falls off linearly to nothing at the hearing distance, as OpenAL does a mono one's. */
    @Override
    public float getVolume() {
        float volume = super.getVolume();
        if (!stereo) {
            return volume;
        }
        double away = Minecraft.getInstance().gameRenderer.getMainCamera().getPosition()
                .distanceTo(new Vec3(x, y, z));
        return volume * (float) Math.max(0.0, 1.0 - away / (distance * Math.max(this.volume, 1.0F)));
    }

    /** Loops start silent and fade in, so the engine must not skip them at volume 0. */
    @Override
    public boolean canStartSilent() {
        return true;
    }

    @Override
    public void tick() {
        // TrainSounds drives the instance from its own tick
    }

    void moveTo(double x, double y, double z) {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    void set(float volume, float pitch) {
        this.volume = volume;
        this.pitch = pitch;
    }

    /** Stop playing at the sound engine's next tick. */
    void end() {
        stop();
    }

    /** A pack file played from its own path, whatever folder it is in. */
    private static final class FileSound extends Sound {
        private final ResourceLocation file;

        FileSound(ResourceLocation file, int distance) {
            super(file, ConstantFloat.of(1.0F), ConstantFloat.of(1.0F), 1, Sound.Type.FILE,
                    false, false, distance);
            this.file = file;
        }

        @Override
        public ResourceLocation getPath() {
            return file;
        }
    }
}
