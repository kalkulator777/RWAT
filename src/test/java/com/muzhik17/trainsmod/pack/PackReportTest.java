package com.muzhik17.trainsmod.pack;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;

/** The report of the loaders' problems: each loader replaces its own part, nothing goes stale. */
class PackReportTest {

    private static final PackOrigin TYPE_A = new PackOrigin("rwat/B", "data/b/wagon_types/a.json");
    private static final PackOrigin MODEL = new PackOrigin("rwat/A", "assets/a/wagon_models/m.json");

    @Test
    void eachSourceReplacesOnlyItsOwnPart() {
        PackReport report = new PackReport();
        report.replace(PackReport.Source.WAGON_TYPES, Map.of("rwat/B", 3),
                List.of(TYPE_A.warning("unknown key 'x' (ignored)"), TYPE_A.error("bad")));
        report.replace(PackReport.Source.TRACK_BEDS, Map.of("rwat/B", 2), List.of());
        assertEquals(1, report.errors());
        assertEquals(1, report.warnings());

        // the reload fixed the file: its problems go with it, the other source's stay
        report.replace(PackReport.Source.WAGON_TYPES, Map.of("rwat/B", 4), List.of());
        assertEquals(0, report.errors() + report.warnings());
        assertEquals(Map.of("rwat/B", Map.of(PackReport.Source.WAGON_TYPES, 4, PackReport.Source.TRACK_BEDS, 2)),
                report.loaded());

        report.clear(PackReport.Source.TRACK_BEDS);
        assertFalse(report.has(PackReport.Source.TRACK_BEDS));
        assertTrue(report.has(PackReport.Source.WAGON_TYPES));
    }

    @Test
    void problemsListErrorsFirstThenByPackAndFile() {
        PackReport report = new PackReport();
        report.replace(PackReport.Source.WAGON_TYPES, Map.of(), List.of(TYPE_A.warning("w1"), TYPE_A.error("e1")));
        report.replace(PackReport.Source.WAGON_MODELS, Map.of("rwat/A", 1),
                List.of(MODEL.warning("w2"), MODEL.error("e2")));
        assertEquals(List.of("e2", "e1", "w2", "w1"),
                report.problems().stream().map(PackProblem::message).toList());
        assertEquals(List.of("e2", "w2"),
                report.problems(PackReport.Source.WAGON_MODELS).stream().map(PackProblem::message).toList());
        assertEquals(Set.of("rwat/A", "rwat/B"), report.packs(), "a pack with only problems is listed too");
    }

    /**
     * The pack scan's problems with the rwat block are the report's like any
     * loader's: a pack too new for this RWAT counts as an error (the
     * operators' notice), a pack without a format number as a warning.
     */
    @Test
    void theRwatBlocksProblemsJoinTheReport() {
        String mcmeta = "{ \"pack\": { \"pack_format\": 34, \"description\": \"x\" }";
        RwatPackMeta.Result future = RwatPackMeta.parse(mcmeta + ", \"rwat\": { \"format\": 2 } }",
                PackInfo.idOf("Future.zip"));
        RwatPackMeta.Result old = RwatPackMeta.parse(mcmeta + " }", PackInfo.idOf("Old"));
        List<PackInfo> scan = List.of(
                new PackInfo("Future.zip", Path.of("Future.zip"), future.meta(), future.problems(), false),
                new PackInfo("Old", Path.of("Old"), old.meta(), old.problems(), true));

        PackReport report = new PackReport();
        report.replace(PackReport.Source.WAGON_TYPES, Map.of("rwat/Old", 2), List.of());
        report.replace(PackReport.Source.PACKS, Map.of(), PackInfo.problems(scan));

        assertEquals(1, report.errors());
        assertEquals(1, report.warnings());
        PackProblem first = report.problems().get(0);
        assertEquals(List.of("rwat/Future.zip", "pack.mcmeta"), List.of(first.pack(), first.file()));
        assertTrue(first.message().contains("newer"), first.message());
        assertEquals(Set.of("rwat/Future.zip", "rwat/Old"), report.packs());
        assertEquals(Map.of("rwat/Old", Map.of(PackReport.Source.WAGON_TYPES, 2)), report.loaded(),
                "the scan counts nothing");
    }

    /** D4: a model is tied to its type only by the id; one without a type is never drawn. */
    @Test
    void modelsWithoutType_areWarnedAboutBySortedId() {
        PackOrigin other = new PackOrigin("rwat/A", "assets/a/wagon_models/chme3_old.json");
        List<PackProblem> problems = PackReport.modelsWithoutType(
                Map.of("a:m", MODEL, "a:chme3_old", other, "a:chme3", MODEL), Set.of("a:chme3", "a:m"));
        assertEquals(1, problems.size());
        PackProblem problem = problems.get(0);
        assertFalse(problem.isError());
        assertEquals(other.file(), problem.file());
        assertTrue(problem.message().startsWith("no wagon type 'a:chme3_old' on the server"), problem.message());
        assertTrue(PackReport.modelsWithoutType(Map.of("a:m", MODEL), Set.of("a:m")).isEmpty());
    }

    /**
     * The reverse: a type the server sent and this client declares no model
     * for is drawn as a box. It is named by the server's file for the type,
     * under the pack "server", in sorted order, one warning each.
     */
    @Test
    void typesWithoutModel_areWarnedAboutBySortedId() {
        List<PackProblem> problems = PackReport.typesWithoutModel(Set.of("a:m", "b:tank/big", "a:chme3"),
                Set.of("a:m"));
        assertEquals(2, problems.size());
        PackProblem first = problems.get(0);
        assertFalse(first.isError());
        assertEquals(PackReport.SERVER_PACK, first.pack());
        assertEquals("data/a/wagon_types/chme3.json", first.file());
        assertTrue(first.message().startsWith("wagon type 'a:chme3' has no model on this client"), first.message());
        assertTrue(first.message().contains("assets/a/wagon_models/chme3.json"), first.message());
        assertEquals("data/b/wagon_types/tank/big.json", problems.get(1).file());
        assertTrue(PackReport.typesWithoutModel(Set.of("a:m"), Set.of("a:m", "a:spare")).isEmpty(),
                "a model for a type nobody has is the other check's");
        assertTrue(PackReport.typesWithoutModel(Set.of(), Set.of()).isEmpty());
    }

    /** One list for the client's report and log: the models without a type first, then the types without a model. */
    @Test
    void theModelTypeCheckReportsBothDirections() {
        List<PackProblem> problems = PackReport.modelTypeProblems(
                Map.of("a:m", MODEL, "a:orphan", MODEL), Set.of("a:m", "a:boxed"));
        assertEquals(2, problems.size());
        assertTrue(problems.get(0).message().startsWith("no wagon type 'a:orphan'"), problems.get(0).message());
        assertTrue(problems.get(1).message().startsWith("wagon type 'a:boxed' has no model"),
                problems.get(1).message());
        assertTrue(PackReport.modelTypeProblems(Map.of("a:m", MODEL), Set.of("a:m")).isEmpty());
    }
}
