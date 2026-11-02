package com.muzhik17.trainsmod.pack;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

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
}
